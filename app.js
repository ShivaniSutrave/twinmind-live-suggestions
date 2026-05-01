/* =============================================
   TwinMind Live Suggestions v2 — app.js
   ============================================= */

const DEFAULTS = {
  suggestionPrompt: `You are a professional AI meeting copilot. Analyze ONLY the most recent transcript provided and generate exactly 3 suggestions to help RIGHT NOW.

Meeting type: {{MEETING_TYPE}}

IMPORTANT RULES:
- Base suggestions ONLY on the recent text, not older context
- Be professional, respectful, and constructive. Never use offensive language.
- Each preview must be standalone useful (1-2 sentences, specific and concrete)
- Mix types based on what's most useful right now

Return ONLY valid JSON, nothing else:
{"suggestions":[{"type":"ANSWER","preview":"specific answer here","confidence":"HIGH"},{"type":"QUESTION","preview":"specific question to ask","confidence":"MEDIUM"},{"type":"TALKING_POINT","preview":"specific point to raise","confidence":"HIGH"}]}

Types allowed: ANSWER, QUESTION, TALKING_POINT, FACT_CHECK, CLARIFICATION
Confidence: HIGH (directly relevant), MEDIUM (contextually relevant), LOW (speculative)`,

  chatPrompt: `You are a professional AI meeting copilot. Answer clearly and concisely in 3-5 sentences maximum.

Meeting type: {{MEETING_TYPE}}
Recent conversation:
{{TRANSCRIPT}}

Question: "{{QUESTION}}"

Rules:
- Be professional and respectful. No offensive or inappropriate language.
- Be specific and actionable, not generic
- Maximum 100 words
- Get straight to the point`,

  notesPrompt: `You are an AI meeting note-taker. Analyze this recent conversation snippet and extract important items.

Return ONLY valid JSON, nothing else:
{"notes":[{"type":"KEY_POINT","text":"what was noted","suggestion":"how to build on this"},{"type":"CONCERN","text":"the concern raised","suggestion":"how to address it"}]}

Types: KEY_POINT, CONCERN, PROBLEM, ACTION_ITEM
Only include items clearly mentioned. Return empty array if nothing important: {"notes":[]}
Maximum 2 notes per call.`,

  summaryPrompt: `You are a professional AI meeting copilot. Summarize this meeting transcript professionally.

Transcript:
{{TRANSCRIPT}}

Return ONLY valid JSON:
{"meetingType":"string","oneLineSummary":"one clear sentence","keyPoints":["point1","point2","point3"],"actionItems":["action1","action2"],"concerns":["concern1"],"decisions":["decision1"],"unansweredQuestions":["q1"]}`,

  suggestionContext: 120,
  chatContext: 400,
  refreshInterval: 30,
};

const state = {
  apiKey: '',
  isRecording: false,
  recognition: null,
  mediaRecorder: null,
  audioChunks: [],
  transcriptChunks: [],
  recentTranscript: '',
  fullTranscript: '',
  suggestionBatches: [],
  chatHistory: [],
  notes: [],
  meetingType: 'General',
  timerSeconds: 0,
  timerInterval: null,
  autoRefreshTimeout: null,
  notesRefreshTimeout: null,
  nextRefreshAt: null,
  topicCount: 1,
  settings: { ...DEFAULTS },
  ratings: {},
  sessionHistory: [],
};

// ── CHANGE THIS TO YOUR REAL GROQ KEY ──
const BUILT_IN_API_KEY = 'YOUR_GROQ_KEY_HERE';

window.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadSessionHistory();
  // No popup — key is built in
});

function loadSettings() {
  state.apiKey = localStorage.getItem('tm_apikey') || BUILT_IN_API_KEY;
  try {
    const saved = JSON.parse(localStorage.getItem('tm_settings') || '{}');
    state.settings = { ...DEFAULTS, ...saved };
  } catch { state.settings = { ...DEFAULTS }; }
  applySettingsToForm();
}

function applySettingsToForm() {
  setValue('apiKey', state.apiKey);
  setValue('suggestionPrompt', state.settings.suggestionPrompt);
  setValue('chatPrompt', state.settings.chatPrompt);
  setValue('summaryPrompt', state.settings.summaryPrompt);
  setValue('suggestionContext', state.settings.suggestionContext);
  setValue('chatContext', state.settings.chatContext);
  setValue('refreshInterval', state.settings.refreshInterval);
}

function saveSettings() {
  const key = getValue('apiKey').trim();
  if (!key) { alert('Please enter your Groq API key.'); return; }
  state.apiKey = key;
  localStorage.setItem('tm_apikey', key);
  state.settings = {
    suggestionPrompt: getValue('suggestionPrompt'),
    chatPrompt: getValue('chatPrompt'),
    notesPrompt: state.settings.notesPrompt || DEFAULTS.notesPrompt,
    summaryPrompt: getValue('summaryPrompt'),
    suggestionContext: parseInt(getValue('suggestionContext')) || DEFAULTS.suggestionContext,
    chatContext: parseInt(getValue('chatContext')) || DEFAULTS.chatContext,
    refreshInterval: parseInt(getValue('refreshInterval')) || DEFAULTS.refreshInterval,
  };
  localStorage.setItem('tm_settings', JSON.stringify(state.settings));
  closeSettings();
}

function openSettings() { applySettingsToForm(); show('settings-modal'); }
function closeSettings() { hide('settings-modal'); }

async function toggleMic() {
  if (state.isRecording) stopRecording();
  else await startRecording();
}

async function startRecording() {
  if (!state.apiKey) { openSettings(); return; }
  try {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      state.recognition = new SR();
      state.recognition.continuous = true;
      state.recognition.interimResults = true;
      state.recognition.lang = 'en-US';
      state.recognition.onresult = (event) => {
        let interim = '', final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) final += t;
          else interim += t;
        }
        updateLiveTranscript(interim, final);
      };
      state.recognition.onerror = (e) => { if (e.error !== 'no-speech') console.warn('SR error:', e.error); };
      state.recognition.onend = () => { if (state.isRecording) { try { state.recognition.start(); } catch(e) {} } };
      state.recognition.start();
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.mediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
    state.audioChunks = [];
    state.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) state.audioChunks.push(e.data); };
    state.mediaRecorder.start(1000);

    state.isRecording = true;
    state.recentTranscript = '';
    updateMicUI(true);
    startTimer();
    scheduleAutoRefresh();
    scheduleNotesRefresh();
  } catch (err) {
    alert('Microphone access denied. Please allow microphone in browser settings.');
    console.error(err);
  }
}

function stopRecording() {
  state.isRecording = false;
  if (state.recognition) { try { state.recognition.stop(); } catch(e) {} state.recognition = null; }
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
    state.mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  clearInterval(state.timerInterval);
  clearTimeout(state.autoRefreshTimeout);
  clearTimeout(state.notesRefreshTimeout);
  updateMicUI(false);
  stopTimer();
  document.getElementById('next-refresh-label').textContent = '—';
  if (state.fullTranscript.trim().length > 50) {
    saveSessionToHistory();
    setTimeout(showPostMeetingSummary, 500);
  }
}

let interimDiv = null;
function updateLiveTranscript(interim, final) {
  const box = document.getElementById('transcript-box');
  const ph = box.querySelector('.placeholder-text');
  if (ph) ph.remove();

  if (final.trim()) {
    if (interimDiv) { interimDiv.remove(); interimDiv = null; }
    const ts = formatTime(new Date());
    const text = sanitizeText(final.trim());
    state.transcriptChunks.push({ text, ts, topic: state.topicCount });
    state.fullTranscript += ' ' + text;
    state.recentTranscript += ' ' + text;
    const div = document.createElement('div');
    div.className = 'transcript-chunk';
    div.innerHTML = `<span class="ts">${ts}</span>${escapeHtml(text)}`;
    box.appendChild(div);
    if (state.fullTranscript.split(' ').length === 25 && state.meetingType === 'General') detectMeetingType();
  }

  if (interim.trim()) {
    if (!interimDiv) {
      interimDiv = document.createElement('div');
      interimDiv.className = 'transcript-chunk interim';
      interimDiv.style.color = 'var(--text-muted)';
      interimDiv.style.fontStyle = 'italic';
      box.appendChild(interimDiv);
    }
    interimDiv.textContent = sanitizeText(interim);
  } else if (interimDiv) { interimDiv.remove(); interimDiv = null; }

  box.scrollTop = box.scrollHeight;
}

function newTopic() {
  state.topicCount++;
  state.recentTranscript = '';
  state.meetingType = 'General';
  const box = document.getElementById('transcript-box');
  const div = document.createElement('div');
  div.className = 'topic-divider';
  div.textContent = `NEW TOPIC ${state.topicCount} · ${formatTime(new Date())}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  document.getElementById('meeting-type-badge').classList.add('hidden');
  document.getElementById('suggestions-container').querySelectorAll('.batch-group').forEach(g => {
    g.style.opacity = '0.2'; g.style.pointerEvents = 'none';
  });
  if (state.isRecording) { clearTimeout(state.autoRefreshTimeout); scheduleAutoRefresh(); }
}

async function detectMeetingType() {
  if (!state.apiKey) return;
  try {
    const res = await callGroq([{ role: 'user', content: `What type of meeting is this? Reply with ONLY 2-3 words. Examples: Job Interview, Sales Call, Technical Meeting, Team Standup, Brainstorm, Award Speech, Client Meeting, Lecture.\n\nTranscript: "${state.fullTranscript.slice(0, 300)}"` }], 15);
    const type = res.trim().replace(/["'.]/g, '').slice(0, 30);
    if (type) {
      state.meetingType = type;
      const badge = document.getElementById('meeting-type-badge');
      badge.textContent = '📍 ' + type.toUpperCase();
      badge.classList.remove('hidden');
    }
  } catch(e) { console.warn('Meeting type detection failed'); }
}

function scheduleAutoRefresh() {
  const secs = state.settings.refreshInterval || 30;
  state.nextRefreshAt = Date.now() + secs * 1000;
  updateCountdown();
  state.autoRefreshTimeout = setTimeout(async () => {
    if (state.isRecording && state.recentTranscript.trim().split(' ').length > 5) await generateSuggestions();
    if (state.isRecording) scheduleAutoRefresh();
  }, secs * 1000);
}

function updateCountdown() {
  if (!state.isRecording || !state.nextRefreshAt) return;
  const secs = Math.max(0, Math.round((state.nextRefreshAt - Date.now()) / 1000));
  document.getElementById('next-refresh-label').textContent = `auto-refresh in ${secs}s`;
  if (state.isRecording) setTimeout(updateCountdown, 1000);
}

async function manualRefresh() {
  if (!state.recentTranscript.trim() && !state.fullTranscript.trim()) { alert('Start recording and speak first!'); return; }
  clearTimeout(state.autoRefreshTimeout);
  await generateSuggestions();
  if (state.isRecording) scheduleAutoRefresh();
}

async function generateSuggestions() {
  const btn = document.getElementById('reload-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="reload-icon">↻</span> Generating...';
  try {
    const words = state.settings.suggestionContext || 120;
    const recentText = getLastNWords(state.recentTranscript || state.fullTranscript, words);
    if (!recentText.trim()) return;
    const prompt = state.settings.suggestionPrompt.replace('{{MEETING_TYPE}}', state.meetingType);
    const raw = await callGroq([{ role: 'user', content: `Recent conversation (last ~${words} words only):\n"${recentText}"\n\n${prompt}` }], 500);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON');
    const parsed = JSON.parse(match[0]);
    const suggestions = (parsed.suggestions || []).slice(0, 3);
    if (suggestions.length === 0) throw new Error('Empty');
    addSuggestionBatch(suggestions);
  } catch (err) { console.error('Suggestion error:', err); }
  finally { btn.disabled = false; btn.innerHTML = '<span class="reload-icon">↻</span> Reload suggestions'; }
}

function addSuggestionBatch(suggestions) {
  const batchId = Date.now();
  const ts = formatTime(new Date());
  state.suggestionBatches.unshift({ id: batchId, suggestions, ts });
  document.getElementById('batch-count').textContent = `${state.suggestionBatches.length} BATCHES`;
  const container = document.getElementById('suggestions-container');
  const ph = container.querySelector('.placeholder-text');
  if (ph) ph.remove();
  container.querySelectorAll('.batch-group').forEach(g => g.classList.add('old'));
  const group = document.createElement('div');
  group.className = 'batch-group';
  const label = document.createElement('div');
  label.className = 'batch-label';
  label.textContent = `BATCH ${state.suggestionBatches.length} · ${ts}`;
  group.appendChild(label);
  suggestions.forEach((s, i) => group.appendChild(createSuggestionCard(s, batchId, i)));
  container.insertBefore(group, container.firstChild);
}

function createSuggestionCard(suggestion, batchId, index) {
  const card = document.createElement('div');
  card.className = 'suggestion-card';
  const cardId = `${batchId}-${index}`;
  const type = (suggestion.type || 'ANSWER').replace(/\s+/g, '_');
  const conf = (suggestion.confidence || 'MEDIUM').toLowerCase();
  card.innerHTML = `
    <div class="card-top">
      <span class="card-tag tag-${type}">${escapeHtml(type.replace(/_/g,' '))}</span>
      <span class="card-confidence conf-${conf}"><span class="conf-dot"></span>${conf.toUpperCase()}</span>
    </div>
    <div class="card-preview">${escapeHtml(suggestion.preview || '')}</div>
    <div class="card-rating">
      <button class="rating-btn" onclick="rateCard(event,'${cardId}','up')">👍 Helpful</button>
      <button class="rating-btn" onclick="rateCard(event,'${cardId}','down')">👎 Not useful</button>
    </div>`;
  card.addEventListener('click', (e) => { if (e.target.closest('.card-rating')) return; openSuggestionInChat(suggestion); });
  return card;
}

function rateCard(event, cardId, direction) {
  event.stopPropagation();
  const card = event.target.closest('.suggestion-card');
  card.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('rated-up', 'rated-down'));
  if (state.ratings[cardId] === direction) delete state.ratings[cardId];
  else { state.ratings[cardId] = direction; event.target.classList.add(direction === 'up' ? 'rated-up' : 'rated-down'); }
}

function scheduleNotesRefresh() {
  state.notesRefreshTimeout = setTimeout(async () => {
    if (state.isRecording && state.recentTranscript.trim().split(' ').length > 8) await generateNotes();
    if (state.isRecording) scheduleNotesRefresh();
  }, 35000);
}

async function generateNotes() {
  try {
    const recentText = getLastNWords(state.recentTranscript, 200);
    if (!recentText.trim()) return;
    const prompt = state.settings.notesPrompt || DEFAULTS.notesPrompt;
    const raw = await callGroq([{ role: 'user', content: `Conversation snippet:\n"${recentText}"\n\n${prompt}` }], 400);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return;
    const parsed = JSON.parse(match[0]);
    (parsed.notes || []).forEach(note => {
      if (note.text && note.text.trim()) { addNoteCard(note); state.notes.push({ ...note, ts: new Date().toISOString() }); }
    });
  } catch(e) { console.warn('Notes generation failed:', e); }
}

function addNoteCard(note) {
  const container = document.getElementById('notes-container');
  const ph = container.querySelector('.placeholder-text');
  if (ph) ph.remove();
  const type = (note.type || 'KEY_POINT').toLowerCase().replace(/_/g, '-');
  const typeLabel = (note.type || 'KEY_POINT').replace(/_/g, ' ');
  const ts = formatTime(new Date());
  const card = document.createElement('div');
  card.className = `note-card ${type}`;
  card.innerHTML = `
    <div class="note-header">
      <span class="note-tag ${type}">${escapeHtml(typeLabel)}</span>
      <span class="note-ts">${ts}</span>
    </div>
    <div class="note-text">${escapeHtml(note.text || '')}</div>
    ${note.suggestion ? `<div class="note-suggestion">${escapeHtml(note.suggestion)}</div>` : ''}`;
  container.insertBefore(card, container.firstChild);
}

async function openSuggestionInChat(suggestion) {
  addChatBubble('user', suggestion.preview, `[${suggestion.type.replace(/_/g,' ')}]`);
  await getDetailedAnswer(suggestion.preview);
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const question = input.value.trim();
  if (!question) return;
  input.value = '';
  addChatBubble('user', question);
  await getDetailedAnswer(question);
}

function handleChatKey(e) { if (e.key === 'Enter') sendChatMessage(); }

function addChatBubble(role, text, tag = '') {
  const ph = document.getElementById('chat-placeholder');
  if (ph) ph.remove();
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-bubble ${role}`;
  if (role === 'user') {
    div.innerHTML = `<div class="bubble-label">YOU${tag ? ' · ' + tag : ''}</div>${escapeHtml(text)}`;
  } else {
    div.innerHTML = `<div class="bubble-label">ASSISTANT</div><div class="bubble-content"></div>`;
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  state.chatHistory.push({ role, content: text, ts: new Date().toISOString() });
  return div;
}

async function getDetailedAnswer(question) {
  const words = state.settings.chatContext || 400;
  const transcript = getLastNWords(state.recentTranscript || state.fullTranscript, words);
  const prompt = (state.settings.chatPrompt || DEFAULTS.chatPrompt)
    .replace('{{MEETING_TYPE}}', state.meetingType)
    .replace('{{TRANSCRIPT}}', transcript || '(No transcript yet)')
    .replace('{{QUESTION}}', question);
  const bubble = addChatBubble('assistant', '');
  const contentEl = bubble.querySelector('.bubble-content');
  contentEl.classList.add('streaming');
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 200, stream: true, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) { const err = await res.json().catch(()=>({}))); contentEl.classList.remove('streaming'); contentEl.textContent = 'Error: ' + (err.error?.message || 'API error'); return; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullAnswer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6).trim();
        if (json === '[DONE]') continue;
        try { const delta = JSON.parse(json).choices?.[0]?.delta?.content || ''; fullAnswer += delta; contentEl.textContent = sanitizeText(fullAnswer); document.getElementById('chat-messages').scrollTop = 9999; } catch { }
      }
    }
    contentEl.classList.remove('streaming');
  } catch (err) { contentEl.classList.remove('streaming'); contentEl.textContent = 'Network error. Check API key.'; console.error(err); }
}

async function showPostMeetingSummary() {
  show('summary-modal');
  const content = document.getElementById('summary-content');
  content.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  try {
    const prompt = (state.settings.summaryPrompt || DEFAULTS.summaryPrompt).replace('{{TRANSCRIPT}}', state.fullTranscript);
    const raw = await callGroq([{ role: 'user', content: prompt }], 600);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON');
    const p = JSON.parse(match[0]);
    const renderList = (arr) => (arr||[]).length ? `<ul>${arr.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '<p style="color:var(--text-muted)">None noted</p>';
    content.innerHTML = `
      <div class="summary-section"><h3>SUMMARY</h3><p>${escapeHtml(p.oneLineSummary||'')}</p></div>
      <div class="summary-section"><h3>MEETING TYPE</h3><p>${escapeHtml(p.meetingType||state.meetingType)}</p></div>
      <div class="summary-section"><h3>KEY POINTS</h3>${renderList(p.keyPoints)}</div>
      <div class="summary-section"><h3>ACTION ITEMS</h3>${renderList(p.actionItems)}</div>
      <div class="summary-section"><h3>CONCERNS</h3>${renderList(p.concerns)}</div>
      <div class="summary-section"><h3>DECISIONS</h3>${renderList(p.decisions)}</div>
      <div class="summary-section"><h3>UNANSWERED QUESTIONS</h3>${renderList(p.unansweredQuestions)}</div>`;
  } catch (err) { content.innerHTML = '<p style="color:var(--text-muted)">Could not generate summary.</p>'; }
}

function closeSummary() { hide('summary-modal'); }

function saveSessionToHistory() {
  const session = { id: Date.now(), date: new Date().toISOString(), meetingType: state.meetingType, durationSeconds: state.timerSeconds, transcriptChunks: state.transcriptChunks, suggestionBatches: state.suggestionBatches, chatHistory: state.chatHistory, notes: state.notes, ratings: state.ratings, preview: state.fullTranscript.slice(0, 150) };
  const history = getHistory();
  history.unshift(session);
  localStorage.setItem('tm_history', JSON.stringify(history.slice(0, 20)));
}

function loadSessionHistory() {}
function getHistory() { try { return JSON.parse(localStorage.getItem('tm_history') || '[]'); } catch { return []; } }

function openHistory() {
  const history = getHistory();
  const content = document.getElementById('history-content');
  if (history.length === 0) {
    content.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px">No past meetings yet. Complete a session to save it here.</p>';
  } else {
    content.innerHTML = history.map(s => `
      <div class="history-item" onclick="loadHistorySession(${s.id})">
        <div class="history-item-header">
          <span class="history-item-title">📍 ${escapeHtml(s.meetingType)}</span>
          <span class="history-item-meta">${new Date(s.date).toLocaleDateString()} · ${formatDuration(s.durationSeconds||0)}</span>
        </div>
        <div class="history-item-preview">${escapeHtml(s.preview||'')}...</div>
      </div>`).join('');
  }
  show('history-modal');
}

function closeHistory() { hide('history-modal'); }

function loadHistorySession(id) {
  const session = getHistory().find(s => s.id === id);
  if (!session) return;
  const content = document.getElementById('history-content');
  const transcript = (session.transcriptChunks||[]).map(c=>`<div class="transcript-chunk"><span class="ts">${c.ts}</span>${escapeHtml(c.text)}</div>`).join('');
  const suggestions = (session.suggestionBatches||[]).map((b,i)=>`<div style="margin-bottom:12px"><div class="batch-label">BATCH ${i+1} · ${b.ts}</div>${(b.suggestions||[]).map(s=>`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px"><span class="card-tag tag-${(s.type||'ANSWER').replace(/\s+/g,'_')}">${escapeHtml((s.type||'').replace(/_/g,' '))}</span><div style="font-size:0.82rem;margin-top:5px;color:var(--text)">${escapeHtml(s.preview||'')}</div></div>`).join('')}</div>`).join('');
  const chat = (session.chatHistory||[]).map(m=>`<div class="chat-bubble ${m.role}" style="margin-bottom:6px"><div class="bubble-label">${m.role==='user'?'YOU':'ASSISTANT'}</div>${escapeHtml(m.content)}</div>`).join('');
  content.innerHTML = `
    <button class="icon-btn" onclick="openHistory()" style="margin-bottom:14px">← Back to all meetings</button>
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:16px">
      <div style="font-size:0.9rem;font-weight:700;margin-bottom:4px">📍 ${escapeHtml(session.meetingType)}</div>
      <div style="font-size:0.72rem;font-family:var(--font-mono);color:var(--text-muted)">${new Date(session.date).toLocaleString()} · ${formatDuration(session.durationSeconds||0)}</div>
    </div>
    <div style="margin-bottom:16px"><div style="font-size:0.72rem;font-family:var(--font-mono);color:var(--accent2);margin-bottom:8px">TRANSCRIPT</div><div style="max-height:180px;overflow-y:auto;font-size:0.82rem;line-height:1.6">${transcript||'<p style="color:var(--text-muted)">No transcript</p>'}</div></div>
    <div style="margin-bottom:16px"><div style="font-size:0.72rem;font-family:var(--font-mono);color:var(--accent2);margin-bottom:8px">SUGGESTIONS</div><div style="max-height:200px;overflow-y:auto">${suggestions||'<p style="color:var(--text-muted)">No suggestions</p>'}</div></div>
    <div style="margin-bottom:16px"><div style="font-size:0.72rem;font-family:var(--font-mono);color:var(--accent2);margin-bottom:8px">CHAT HISTORY</div><div style="max-height:180px;overflow-y:auto">${chat||'<p style="color:var(--text-muted)">No chat</p>'}</div></div>
    <button class="save-btn" onclick="downloadSession(${id})" style="width:100%">⬇ Download as JSON</button>`;
}

function downloadSession(id) {
  const session = getHistory().find(s => s.id === id);
  if (!session) return;
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `meeting-${session.meetingType.replace(/\s+/g,'-')}-${session.id}.json`; a.click();
  URL.revokeObjectURL(url);
}

function exportSession() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), meetingType: state.meetingType, durationSeconds: state.timerSeconds, transcript: state.transcriptChunks, suggestionBatches: state.suggestionBatches, chatHistory: state.chatHistory, notes: state.notes, ratings: state.ratings }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `twinmind-${Date.now()}.json`; a.click();
  URL.revokeObjectURL(url);
}

function startTimer() {
  state.timerSeconds = 0;
  const el = document.getElementById('mic-timer');
  el.classList.remove('hidden');
  state.timerInterval = setInterval(() => { state.timerSeconds++; el.textContent = formatDuration(state.timerSeconds); }, 1000);
}
function stopTimer() { document.getElementById('mic-timer').classList.add('hidden'); }

function updateMicUI(recording) {
  const btn = document.getElementById('mic-btn');
  const status = document.getElementById('rec-status');
  if (recording) { btn.classList.add('recording'); document.getElementById('mic-label').textContent = 'Recording... Click to stop'; status.textContent = '● RECORDING'; status.style.color = 'var(--red)'; }
  else { btn.classList.remove('recording'); document.getElementById('mic-label').textContent = 'Click to start'; status.textContent = 'IDLE'; status.style.color = ''; }
}

async function callGroq(messages, maxTokens = 400) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${state.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: maxTokens, messages }),
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error?.message||'Groq error'); }
  return (await res.json()).choices?.[0]?.message?.content || '';
}

function sanitizeText(text) {
  const badWords = ['fuck','shit','bitch','damn','crap','bastard'];
  let clean = String(text);
  badWords.forEach(w => { clean = clean.replace(new RegExp(`\\b${w}\\b`, 'gi'), '*'.repeat(w.length)); });
  return clean;
}

function getLastNWords(text, n) { return (text||'').trim().split(/\s+/).filter(Boolean).slice(-n).join(' '); }
function formatTime(date) { return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function formatDuration(secs) { return `${String(Math.floor(secs/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`; }
function escapeHtml(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function getSupportedMimeType() { return ['audio/webm;codecs=opus','audio/webm','audio/ogg','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t))||'audio/webm'; }
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function toggleMoreMenu() {
  const menu = document.getElementById('more-menu');
  menu.classList.toggle('hidden');
  setTimeout(() => { document.addEventListener('click', function closeMenu(e) { if (!e.target.closest('.more-menu-wrap')) { menu.classList.add('hidden'); document.removeEventListener('click', closeMenu); } }); }, 10);
}
function getValue(id) { return document.getElementById(id)?.value || ''; }
function setValue(id, val) { const el = document.getElementById(id); if (el) el.value = val ?? ''; }
