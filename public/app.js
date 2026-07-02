'use strict';
const $ = s => document.querySelector(s);
const yards = ['Todos', 'Cajamar', 'Jaraguá', 'Bandeirantes', 'Pátio Superior'];
const areaNames = { manutencao: 'Manutenção', borracharia: 'Borracharia', documentacao: 'Documentação' };
let state = { user: null, vehicles: [], history: [], checklistTemplate: {} }, activeYard = 'Todos';

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Falha na solicitação.'); return data;
}
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2600); }
function esc(value) { const d = document.createElement('div'); d.textContent = value || ''; return d.innerHTML; }
function loginScreen() { $('#loginView').classList.remove('hidden'); $('#appView').classList.add('hidden'); }
async function enter(user) {
  state.user = user; $('#userName').textContent = user.name; $('#userRole').textContent = user.role; $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden'); await load();
}
async function load() { const data = await request('/api/state'); Object.assign(state, data); render(); }
function totals(vehicle) { const items = Object.values(vehicle.checklist || {}).flat(); const done = items.filter(x => x.status === 'concluido' || x.status === 'nao_aplicado').length; return { done, total: items.length, pct: items.length ? Math.round(done / items.length * 100) : 0 }; }
function yardDays(vehicle) { const start = new Date(`${vehicle.enteredAt || vehicle.createdAt?.slice(0,10)}T12:00:00`); return Number.isNaN(start.getTime()) ? 0 : Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000)); }
function areaBadge(area, items) { const done = items.filter(x => ['concluido','nao_aplicado'].includes(x.status)).length; const cls = done === items.length ? 'badge-ok' : done ? 'badge-warn' : 'badge-bad'; const short = {documentacao:'DOC',borracharia:'BOR',manutencao:'MAN'}[area] || area.slice(0,3).toUpperCase(); return `<span class="check-badge ${cls}">${short} ${done}/${items.length}</span>`; }
function render() { renderMetrics(); renderYards(); renderVehicles(); }
function renderMetrics() {
  const pendingLabel = label => state.vehicles.filter(v => Object.values(v.checklist || {}).flat().some(i => i.label === label && !['concluido','nao_aplicado'].includes(i.status))).length;
  const pendingArea = area => state.vehicles.filter(v => (v.checklist?.[area] || []).some(i => !['concluido','nao_aplicado'].includes(i.status))).length;
  const oldest = state.vehicles.reduce((best, v) => !best || yardDays(v) > yardDays(best) ? v : best, null);
  const values = [
    { value: state.vehicles.length, label: 'Veículos na frota', icon: '▣', tone: 'purple' },
    { value: state.vehicles.filter(v => !v.available).length, label: 'Em preparação', icon: '🛠', tone: 'blue' },
    { value: state.vehicles.filter(v => v.available).length, label: 'Prontos para operar', icon: '✓', tone: 'green' },
    { value: oldest ? `${yardDays(oldest)} dias` : '0 dias', label: 'Há mais tempo no pátio', detail: oldest?.plate || 'Nenhum veículo', icon: '⌛', tone: 'orange' },
    { value: pendingArea('documentacao'), label: 'Documentos pendentes', icon: '▤', tone: 'red', signal: true },
    { value: pendingArea('borracharia'), label: 'Pendente de pneus', icon: '◉', tone: 'black', signal: true },
    { value: pendingLabel('Trava do rastreador'), label: 'Trava do rastreador', icon: '⌁', tone: 'cyan', signal: true },
    { value: pendingLabel('Reparo de baú'), label: 'Reparo de baú pendente', icon: '▱', tone: 'amber', signal: true }
  ];
  $('#metrics').innerHTML = values.map(x => `<div class="metric metric-rich ${x.signal && x.value ? 'has-signal' : ''}"><span class="metric-symbol ${x.tone}">${x.icon}</span><div><b>${x.value}</b><span>${x.label}</span>${x.detail ? `<small>${esc(x.detail)}</small>` : ''}</div></div>`).join('');
}
function renderYards() { $('#yardTabs').innerHTML = yards.map(y => `<button class="${activeYard === y ? 'active' : ''}" data-yard="${y}">${y} · ${y === 'Todos' ? state.vehicles.length : state.vehicles.filter(v => v.yard === y).length}</button>`).join(''); }
function plateHtml(v) { return `<div class="plate ${v.plateType}">${esc(v.plate)}</div>`; }
function filtered() {
  const q = $('#search').value.trim().toLowerCase(), status = $('#statusFilter').value;
  return state.vehicles.filter(v => (activeYard === 'Todos' || v.yard === activeYard) && (status === 'all' || (status === 'available') === v.available) && [v.plate,v.fleet,v.type,v.position,v.linkedPlates].join(' ').toLowerCase().includes(q));
}
function renderVehicles() {
  const list = filtered(); $('#vehicleGrid').innerHTML = list.length ? list.map(v => { const t = totals(v), days = yardDays(v); return `<article class="vehicle-card ${v.available ? 'is-ready' : ''}" data-id="${v.id}"><div class="card-hero"><div class="card-flags"><span class="days">${v.available ? '✓' : '◷'} ${days} ${days === 1 ? 'dia' : 'dias'}</span><span class="prep-state">${v.available ? 'Pronto' : 'Em preparação'}</span></div><span class="vehicle-kind">${esc(v.type || 'Carreta')} ${esc((v.brand || '').toUpperCase())}</span><img class="trailer-image" src="/images/${v.brand === 'Randon' ? 'Randon' : 'Facchini'}.png" alt="Carreta ${esc(v.brand)}">${plateHtml(v)}</div><div class="card-body"><div class="stage-box"><span>ESTÁGIO DA PREPARAÇÃO</span><b>${v.available ? 'Pronto para operar' : esc(v.stage || 'Processos')}</b></div><dl class="details"><dt>Próximo</dt><dd>${v.available ? 'Checklist concluído' : esc(v.stage || 'Processos')}</dd><dt>Tipo</dt><dd>${esc(v.type)} ${esc((v.brand || '').toUpperCase())}</dd><dt>Modelo</dt><dd>${esc(v.model || v.type)}</dd><dt>Frota</dt><dd>${esc(v.fleet || '—')}</dd><dt>Chassi</dt><dd>${esc(v.chassis || '—')}</dd><dt>RENAVAM</dt><dd>${esc(v.renavam || '—')}</dd><dt>NF</dt><dd>${esc(v.nf || 'Não informado')}</dd><dt>Operação</dt><dd>${esc(v.operation || 'Padrão')}</dd><dt>Pátio</dt><dd>${esc(v.yard)}</dd><dt>Status</dt><dd>${esc(v.status || 'Aguardando linha')}</dd></dl><div class="progress"><i style="width:${t.pct}%"></i></div><div class="progress-label"><span></span><b>${t.pct}%</b></div><div class="check-badges">${Object.entries(v.checklist || {}).map(([a,i]) => areaBadge(a,i)).join('')}</div><button class="open-checklist">Abrir checklist →</button></div></article>`; }).join('') : '<div class="empty"><h3>Nenhum veículo encontrado</h3><p>Cadastre o primeiro veículo ou altere os filtros.</p></div>';
}
function blankChecklist() { return Object.fromEntries(Object.entries(state.checklistTemplate).map(([area, labels]) => [area, labels.map(label => ({ label, status: 'pendente', note: '' }))])); }
function renderChecklist(checklist) {
  $('#checklistEditor').innerHTML = `<span class="eyebrow">CHECKLIST DE LIBERAÇÃO</span>${Object.entries(checklist).map(([area, items]) => `<section class="area"><h3>${areaNames[area]}</h3>${items.map((item, i) => `<div class="check-row"><span>${esc(item.label)}</span><select data-area="${area}" data-index="${i}"><option value="pendente" ${item.status === 'pendente' ? 'selected' : ''}>Pendente</option><option value="concluido" ${item.status === 'concluido' ? 'selected' : ''}>Concluído</option><option value="nao_aplicado" ${item.status === 'nao_aplicado' ? 'selected' : ''}>Não aplicado</option></select></div>`).join('')}</section>`).join('')}`;
}
function openVehicle(id = '') {
  const v = state.vehicles.find(x => x.id === id); $('#vehicleForm').reset(); $('#vehicleId').value = v?.id || ''; $('#dialogTitle').textContent = v ? `Editar ${v.plate}` : 'Novo veículo'; $('#plate').disabled = Boolean(v);
  const fields = ['plate','brand','type','model','fleet','enteredAt','chassis','renavam','nf','operation','stage','status','yard','position','linkedPlates','notes']; fields.forEach(k => { if (v) $(`#${k}`).value = v[k] || ''; }); if (!v) $('#enteredAt').value = new Date().toISOString().slice(0,10);
  renderChecklist(v?.checklist || blankChecklist()); $('#deleteVehicle').classList.toggle('hidden', !v || state.user.role !== 'admin'); $('#vehicleDialog').showModal();
}
function collectChecklist() { const result = blankChecklist(); document.querySelectorAll('#checklistEditor select').forEach(s => { result[s.dataset.area][Number(s.dataset.index)].status = s.value; }); return result; }
function renderHistory() { $('#historyList').innerHTML = state.history.length ? state.history.map(h => `<div class="history-item"><time>${new Date(h.at).toLocaleString('pt-BR')}</time><div><b>${esc(h.action)} · ${esc(h.plate)}</b><span>${esc(h.user)}${h.detail ? ` — ${esc(h.detail)}` : ''}</span></div></div>`).join('') : '<div class="empty">Nenhum evento registrado.</div>'; }

$('#loginForm').addEventListener('submit', async e => { e.preventDefault(); $('#loginError').textContent = ''; try { const data = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: $('#username').value, password: $('#password').value }) }); await enter(data.user); } catch (err) { $('#loginError').textContent = err.message; } });
$('#showPassword').onclick = () => { $('#password').type = $('#password').type === 'password' ? 'text' : 'password'; };
$('#logout').onclick = async () => { await request('/api/logout', { method: 'POST' }); loginScreen(); };
$('#newVehicle').onclick = () => openVehicle();
$('#yardTabs').onclick = e => { if (e.target.dataset.yard) { activeYard = e.target.dataset.yard; render(); } };
$('#search').oninput = renderVehicles; $('#statusFilter').onchange = renderVehicles;
$('#vehicleGrid').onclick = e => { const card = e.target.closest('[data-id]'); if (card) openVehicle(card.dataset.id); };
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $('#vehicleDialog').close());
$('#vehicleForm').addEventListener('submit', async e => { e.preventDefault(); const id = $('#vehicleId').value; const payload = Object.fromEntries(['plate','brand','type','model','fleet','enteredAt','chassis','renavam','nf','operation','stage','status','yard','position','linkedPlates','notes'].map(k => [k, $(`#${k}`).value])); payload.checklist = collectChecklist(); try { await request(id ? `/api/vehicles/${id}` : '/api/vehicles', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); $('#vehicleDialog').close(); await load(); toast(id ? 'Veículo atualizado.' : 'Veículo cadastrado.'); } catch (err) { toast(err.message); } });
$('#deleteVehicle').onclick = async () => { const id = $('#vehicleId').value; if (!id || !confirm('Excluir este veículo e seus checklists?')) return; try { await request(`/api/vehicles/${id}`, { method: 'DELETE' }); $('#vehicleDialog').close(); await load(); toast('Veículo excluído.'); } catch (err) { toast(err.message); } };
$('#historyButton').onclick = () => { renderHistory(); $('#historyDialog').showModal(); }; $('[data-close-history]').onclick = () => $('#historyDialog').close();

request('/api/me').then(data => enter(data.user)).catch(loginScreen);
