'use strict';

const $ = selector => document.querySelector(selector);
const yards = ['Todos', 'Cajamar', 'Jaraguá', 'Bandeirantes', 'Pátio Superior'];
const outsideStatuses = new Set(['Em rota', 'Fora do pátio', 'Entregue', 'Liberado']);
let state = { user: null, vehicles: [], history: [], checklistTemplate: {} };
let activeYard = 'Todos';
let weekOffset = 0;
let deferredInstallPrompt = null;

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Falha na solicitação.');
  return data;
}

function esc(value) { const node = document.createElement('div'); node.textContent = value || ''; return node.innerHTML; }
function toast(message) { const element = $('#toast'); element.textContent = message; element.classList.add('show'); setTimeout(() => element.classList.remove('show'), 2800); }
function localDateKey(value = new Date()) { const date = value instanceof Date ? value : new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function parseDate(value) { if (!value) return null; const date = new Date(`${String(value).slice(0, 10)}T12:00:00`); return Number.isNaN(date.getTime()) ? null : date; }
function formatDate(value, options = {}) { const date = value instanceof Date ? value : new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR', options); }
function formatDateTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Sem registro' : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function presenceEvents(vehicle) {
  if (Array.isArray(vehicle.presenceEvents)) return [...vehicle.presenceEvents].sort((a, b) => new Date(a.at) - new Date(b.at));
  return (Array.isArray(vehicle.dailyChecks) ? vehicle.dailyChecks : []).map(check => ({ ...check, present: true })).sort((a, b) => new Date(a.at) - new Date(b.at));
}
function latestPresenceEvent(vehicle, reference = new Date()) { return presenceEvents(vehicle).filter(event => new Date(event.at) <= reference).at(-1) || null; }
function isPresentAt(vehicle, reference = new Date()) {
  const entered = parseDate(vehicle.enteredAt || vehicle.createdAt);
  const end = new Date(reference); if (end.getHours() === 12 && end.getMinutes() === 0) end.setHours(23, 59, 59, 999);
  if (entered && entered > end) return false;
  const event = latestPresenceEvent(vehicle, end);
  return event ? Boolean(event.present) : !outsideStatuses.has(vehicle.status || 'No pátio');
}
function isPresent(vehicle) { return isPresentAt(vehicle, new Date()); }
function presenceEventOn(vehicle, date = new Date()) { const key = localDateKey(date); return presenceEvents(vehicle).filter(event => event.date === key || localDateKey(event.at) === key).at(-1) || null; }
function presenceStart(vehicle) {
  if (!isPresent(vehicle)) return null;
  if (vehicle.presenceStartedAt) return new Date(vehicle.presenceStartedAt);
  const events = presenceEvents(vehicle);
  for (let index = events.length - 1; index >= 0; index -= 1) if (events[index].present && (index === 0 || !events[index - 1].present)) return new Date(events[index].at);
  return parseDate(vehicle.enteredAt || vehicle.createdAt);
}
function presenceDurationMs(vehicle) {
  const start = vehicle.presenceStartedAt ? new Date(vehicle.presenceStartedAt) : presenceStart(vehicle) || parseDate(vehicle.enteredAt || vehicle.createdAt);
  if (!start) return 0;
  const last = latestPresenceEvent(vehicle);
  const end = isPresent(vehicle) ? new Date() : new Date(vehicle.presenceEndedAt || (!last?.present ? last?.at : Date.now()));
  return Math.max(0, end - start);
}
function durationLabel(milliseconds) { const hours = Math.floor(milliseconds / 3600000); if (hours < 24) return `${hours}h`; const days = Math.floor(hours / 24); const remainingHours = hours % 24; return `${days}d${remainingHours ? ` ${remainingHours}h` : ''}`; }
function yardDays(vehicle) { return Math.floor(presenceDurationMs(vehicle) / 86400000); }
function statusTone(status) { if (outsideStatuses.has(status)) return 'outside'; if (status === 'Em manutenção') return 'attention'; if (status === 'Aguardando operação') return 'waiting'; return 'present'; }
function vehicleEvents(vehicle) { return state.history.filter(event => event.vehicleId === vehicle.id || (!event.vehicleId && event.plate === vehicle.plate)); }
function lastEvent(vehicle) { return vehicleEvents(vehicle).sort((a, b) => new Date(b.at) - new Date(a.at))[0]; }
function eventsOn(date, vehicle = null) { const key = localDateKey(date); return state.history.filter(event => localDateKey(event.at) === key && (!vehicle || event.vehicleId === vehicle.id || event.plate === vehicle.plate)); }

function loginScreen() { $('#loginView').classList.remove('hidden'); $('#appView').classList.add('hidden'); }
async function enter(user) {
  state.user = user;
  $('#userName').textContent = user.name;
  $('#userRole').textContent = user.role;
  document.querySelectorAll('.admin-backup').forEach(element => element.classList.toggle('hidden', user.role !== 'admin'));
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  await load();
}
async function load() { Object.assign(state, await request('/api/state')); renderAll(); }

function renderAll() {
  $('#todayLabel').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  renderDailyMetrics();
  renderYards();
  renderVehicles();
  renderWeekly();
}

function renderDailyMetrics() {
  const today = localDateKey();
  const present = state.vehicles.filter(isPresent);
  const checked = state.vehicles.filter(vehicle => presenceEventOn(vehicle)).length;
  const pendingChecks = state.vehicles.length - checked;
  const movements = state.history.filter(event => localDateKey(event.at) === today && /Movimenta|Pátio alterado|cadastrado/i.test(event.action)).length;
  const attention = present.filter(vehicle => vehicle.status === 'Em manutenção' || /sinistro|bloqueado/i.test(`${vehicle.status} ${vehicle.notes}`)).length;
  const cards = [
    { value: present.length, label: 'No pátio agora', detail: `${state.vehicles.length - present.length} fora / em rota`, tone: 'blue', icon: 'P' },
    { value: checked, label: 'Conferidos hoje', detail: `${state.vehicles.length ? Math.round(checked / state.vehicles.length * 100) : 0}% dos veículos`, tone: 'green', icon: '✓' },
    { value: pendingChecks, label: 'Faltam conferir', detail: 'Sem OK ou Não OK hoje', tone: pendingChecks ? 'red' : 'green', icon: pendingChecks ? '!' : '✓' },
    { value: movements, label: 'Movimentações hoje', detail: 'Pátio, vaga ou status', tone: 'cyan', icon: 'M' },
    { value: attention, label: 'Exigem atenção', detail: 'Manutenção ou bloqueio', tone: 'amber', icon: 'A' }
  ];
  $('#dailyMetrics').innerHTML = cards.map(card => `<article class="summary-card"><span class="summary-icon ${card.tone}">${card.icon}</span><div><b>${card.value}</b><strong>${card.label}</strong><small>${card.detail}</small></div></article>`).join('');
}

function renderYards() {
  $('#yardTabs').innerHTML = yards.map(yard => {
    const count = yard === 'Todos' ? state.vehicles.filter(isPresent).length : state.vehicles.filter(vehicle => isPresent(vehicle) && vehicle.yard === yard).length;
    return `<button class="${activeYard === yard ? 'active' : ''}" data-yard="${yard}">${yard}<span>${count}</span></button>`;
  }).join('');
}

function filteredVehicles() {
  const query = $('#search').value.trim().toLowerCase();
  const status = $('#statusFilter').value;
  return state.vehicles.filter(vehicle => {
    const yardMatches = activeYard === 'Todos' || vehicle.yard === activeYard;
    const statusMatches = status === 'all' || (status === 'Em rota' ? outsideStatuses.has(vehicle.status) : vehicle.status === status);
    const text = [vehicle.plate, vehicle.fleet, vehicle.type, vehicle.position, vehicle.linkedPlates, vehicle.yard].join(' ').toLowerCase();
    return yardMatches && statusMatches && text.includes(query);
  }).sort((a, b) => Number(isPresent(b)) - Number(isPresent(a)) || String(a.yard).localeCompare(String(b.yard), 'pt-BR') || String(a.plate).localeCompare(String(b.plate), 'pt-BR'));
}

function plateHtml(vehicle) { return `<span class="plate ${vehicle.plateType || ''}">${esc(vehicle.plate)}</span>`; }
function renderVehicles() {
  const vehicles = filteredVehicles();
  $('#resultCount').textContent = `${vehicles.length} veículo${vehicles.length === 1 ? '' : 's'}`;
  if (!vehicles.length) {
    $('#vehicleTable').innerHTML = '<div class="empty"><b>Nenhum veículo encontrado</b><span>Altere os filtros ou registre uma nova entrada.</span></div>';
    return;
  }
  const rows = vehicles.map(vehicle => {
    const event = lastEvent(vehicle);
    const duration = durationLabel(presenceDurationMs(vehicle));
    const todayPresence = presenceEventOn(vehicle);
    return `<div class="vehicle-row ${isPresent(vehicle) ? '' : 'is-outside'}" data-id="${vehicle.id}" role="button" tabindex="0">
      <span class="vehicle-cell identity">${plateHtml(vehicle)}<span><b>${esc(vehicle.type || 'Veículo')}</b><small>${esc(vehicle.fleet ? `Frota ${vehicle.fleet}` : vehicle.linkedPlates || 'Sem conjunto vinculado')}</small></span></span>
      <span class="vehicle-cell"><small>Pátio</small><b>${esc(vehicle.yard || 'Não informado')}</b><em>${esc(vehicle.position || 'Posição não informada')}</em></span>
      <span class="vehicle-cell"><small>Status</small><i class="status-pill ${statusTone(vehicle.status)}">${esc(vehicle.status || 'No pátio')}</i></span>
      <span class="vehicle-cell permanence"><small>${isPresent(vehicle) ? 'Permanência atual' : 'Última permanência'}</small><b>${duration}</b><em>${isPresent(vehicle) ? `Desde ${formatDateTime(presenceStart(vehicle))}` : `Saída ${formatDateTime(vehicle.presenceEndedAt || latestPresenceEvent(vehicle)?.at)}`}</em></span>
      <span class="vehicle-cell daily-check-cell"><small>Presença hoje</small><span class="presence-actions"><button type="button" class="presence-button yes ${todayPresence?.present === true ? 'active' : ''}" data-presence-id="${vehicle.id}" data-present="true">OK</button><button type="button" class="presence-button no ${todayPresence?.present === false ? 'active' : ''}" data-presence-id="${vehicle.id}" data-present="false">Não OK</button></span><em>${todayPresence ? `${todayPresence.present ? 'No pátio' : 'Fora'} · ${formatDateTime(todayPresence.at)}` : 'Aguardando conferência'}</em></span>
      <span class="vehicle-cell last-update"><small>Última movimentação</small><b>${event ? esc(event.action) : 'Sem movimentação'}</b><em>${event ? formatDateTime(event.at) : formatDateTime(vehicle.updatedAt)}</em></span>
      <span class="row-action">Editar →</span>
    </div>`;
  }).join('');
  $('#vehicleTable').innerHTML = `<div class="table-head"><span>Veículo</span><span>Localização</span><span>Status</span><span>Permanência</span><span>OK diário</span><span>Última movimentação</span><span></span></div>${rows}`;
}

function startOfSelectedWeek() {
  const date = new Date();
  const day = date.getDay() || 7;
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - day + 1 + weekOffset * 7);
  return date;
}
function weekDays() { const start = startOfSelectedWeek(); return Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; }); }
function snapshotForDay(vehicle, date) {
  const entered = parseDate(vehicle.enteredAt || vehicle.createdAt);
  const end = new Date(date); end.setHours(23, 59, 59, 999);
  if (entered && entered > end) return null;
  const snapshot = vehicleEvents(vehicle).filter(event => new Date(event.at) <= end && (event.yard || event.status || event.position)).sort((a, b) => new Date(b.at) - new Date(a.at))[0];
  return snapshot ? { ...vehicle, yard: snapshot.yard || vehicle.yard, status: snapshot.status || vehicle.status, position: snapshot.position || vehicle.position } : vehicle;
}

function renderWeekly() {
  const days = weekDays();
  $('#weekLabel').textContent = `${formatDate(days[0], { day: '2-digit', month: 'long' })} a ${formatDate(days[6], { day: '2-digit', month: 'long', year: 'numeric' })}`;
  const weekEvents = state.history.filter(event => { const at = new Date(event.at); const end = new Date(days[6]); end.setHours(23, 59, 59, 999); return at >= days[0] && at <= end; });
  const entries = state.vehicles.filter(vehicle => { const entered = parseDate(vehicle.enteredAt); return entered && entered >= days[0] && entered <= new Date(days[6].getTime() + 86399999); }).length;
  const movedVehicles = new Set(weekEvents.filter(event => /Movimenta|Pátio alterado/i.test(event.action)).map(event => event.vehicleId || event.plate)).size;
  const peak = Math.max(0, ...days.map(day => state.vehicles.filter(vehicle => snapshotForDay(vehicle, day) && isPresentAt(vehicle, day)).length));
  const longStay = state.vehicles.filter(vehicle => isPresent(vehicle) && yardDays(vehicle) >= 7).length;
  const cards = [
    { value: peak, label: 'Pico de ocupação', detail: 'Maior total diário', tone: 'blue', icon: 'P' },
    { value: entries, label: 'Entradas na semana', detail: 'Veículos recebidos', tone: 'green', icon: 'E' },
    { value: movedVehicles, label: 'Veículos movimentados', detail: `${weekEvents.length} registros no período`, tone: 'cyan', icon: 'M' },
    { value: longStay, label: 'Há 7 dias ou mais', detail: 'Permanência prolongada', tone: 'amber', icon: '7' }
  ];
  $('#weeklyMetrics').innerHTML = cards.map(card => `<article class="summary-card"><span class="summary-icon ${card.tone}">${card.icon}</span><div><b>${card.value}</b><strong>${card.label}</strong><small>${card.detail}</small></div></article>`).join('');
  renderOccupancy(days);
  renderMovementSummary(weekEvents);
  renderWeeklyTable(days);
}

function renderOccupancy(days) {
  const values = days.map(day => state.vehicles.filter(vehicle => snapshotForDay(vehicle, day) && isPresentAt(vehicle, day)).length);
  const max = Math.max(1, ...values);
  $('#occupancyChart').innerHTML = days.map((day, index) => `<div class="bar-column"><b>${values[index]}</b><div class="bar-track"><i style="height:${Math.max(8, values[index] / max * 100)}%"></i></div><span>${day.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</span><small>${day.getDate()}</small></div>`).join('');
}

function renderMovementSummary(events) {
  const movements = events.filter(event => /Movimenta|Pátio alterado|cadastrado/i.test(event.action)).sort((a, b) => new Date(b.at) - new Date(a.at));
  $('#movementSummary').innerHTML = movements.length ? movements.slice(0, 7).map(event => `<div class="movement-item"><span class="movement-dot"></span><div><b>${esc(event.plate)} · ${esc(event.action)}</b><small>${esc(event.detail || event.yard || 'Registro operacional')} · ${formatDateTime(event.at)}</small></div></div>`).join('') : '<div class="empty compact-empty"><b>Sem movimentações nesta semana</b><span>As alterações de pátio, posição e status aparecerão aqui.</span></div>';
}

function renderWeeklyTable(days) {
  const select = $('#weeklyVehicleFilter');
  const selected = select.value || 'all';
  select.innerHTML = '<option value="all">Todos</option>' + [...state.vehicles].sort((a, b) => String(a.plate).localeCompare(String(b.plate))).map(vehicle => `<option value="${vehicle.id}">${esc(vehicle.plate)}</option>`).join('');
  select.value = state.vehicles.some(vehicle => vehicle.id === selected) ? selected : 'all';
  const vehicles = state.vehicles.filter(vehicle => select.value === 'all' || vehicle.id === select.value).sort((a, b) => String(a.plate).localeCompare(String(b.plate), 'pt-BR'));
  const header = days.map(day => `<span><b>${day.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</b><small>${day.getDate()}</small></span>`).join('');
  const rows = vehicles.map(vehicle => `<div class="week-row" data-timeline-id="${vehicle.id}" role="button" tabindex="0" title="Abrir timeline de ${esc(vehicle.plate)}"><div class="week-vehicle">${plateHtml(vehicle)}<small>${esc(vehicle.type || '')} · Ver timeline</small></div>${days.map(day => {
    const snapshot = snapshotForDay(vehicle, day);
    const events = eventsOn(day, vehicle);
    if (!snapshot) return '<span class="day-cell empty-day">—</span>';
    const present = isPresentAt(vehicle, day);
    const mark = presenceEventOn(vehicle, day);
    return `<span class="day-cell ${mark ? mark.present ? 'checked-day' : 'outside-day' : present ? 'present-day' : 'outside-day'}" title="${esc(snapshot.status || '')}"><b>${mark ? mark.present ? '✓ OK' : '✕ Não OK' : present ? esc((snapshot.yard || 'Pátio').replace('Pátio ', '')) : 'Fora'}</b><small>${mark ? formatDateTime(mark.at) : present ? 'Sem conferência' : events.length ? `${events.length} mov.` : esc(snapshot.position || 'Sem alteração')}</small></span>`;
  }).join('')}</div>`).join('');
  $('#weeklyTable').innerHTML = vehicles.length ? `<div class="week-header"><span>Veículo</span>${header}</div>${rows}` : '<div class="empty"><b>Nenhum veículo para exibir</b></div>';
}

function presencePeriods(vehicle) {
  const periods = [];
  let openedAt = parseDate(vehicle.enteredAt || vehicle.createdAt);
  for (const event of presenceEvents(vehicle)) {
    const at = new Date(event.at);
    if (event.present && !openedAt) openedAt = at;
    if (!event.present && openedAt) { periods.push({ start: openedAt, end: at }); openedAt = null; }
  }
  if (openedAt) periods.push({ start: openedAt, end: isPresent(vehicle) ? new Date() : new Date(vehicle.presenceEndedAt || latestPresenceEvent(vehicle)?.at || Date.now()) });
  return periods.filter(period => period.end >= period.start);
}

function openVehicleTimeline(id) {
  const vehicle = state.vehicles.find(item => item.id === id);
  if (!vehicle) return;
  const periods = presencePeriods(vehicle);
  const totalMs = periods.reduce((sum, period) => sum + Math.max(0, period.end - period.start), 0);
  const marks = presenceEvents(vehicle);
  $('#timelineTitle').textContent = `Timeline · ${vehicle.plate}`;
  $('#timelineSubtitle').textContent = `${vehicle.type || 'Veículo'} · ${vehicle.yard || 'Pátio não informado'} · ${vehicle.position || 'Sem posição'}`;
  $('#timelineStats').innerHTML = `<article><small>Situação atual</small><b class="${isPresent(vehicle) ? 'text-present' : 'text-outside'}">${isPresent(vehicle) ? 'No pátio' : 'Fora do pátio'}</b></article><article><small>Entradas registradas</small><b>${Math.max(1, periods.length)}</b></article><article><small>Tempo total no pátio</small><b>${durationLabel(totalMs)}</b></article><article><small>Última marcação</small><b>${marks.length ? formatDateTime(marks.at(-1).at) : 'Sem marcação'}</b></article>`;
  const presenceItems = marks.map(mark => ({ at: mark.at, tone: mark.present ? 'entry' : 'exit', title: mark.present ? 'OK · Entrada/presença confirmada' : 'Não OK · Saída confirmada', detail: `${mark.yard || vehicle.yard || 'Pátio não informado'}${mark.position ? ` · ${mark.position}` : ''}`, user: mark.user }));
  const historyItems = vehicleEvents(vehicle).filter(event => !/Presença confirmada|Saída confirmada|Conferência diária OK/i.test(event.action)).map(event => ({ at: event.at, tone: /excluído/i.test(event.action) ? 'exit' : /cadastrado/i.test(event.action) ? 'entry' : 'movement', title: event.action, detail: event.detail || [event.yard, event.position, event.status].filter(Boolean).join(' · '), user: event.user }));
  const items = [...presenceItems, ...historyItems].sort((a, b) => new Date(b.at) - new Date(a.at));
  $('#timelineList').innerHTML = items.length ? items.map(item => `<article class="timeline-item ${item.tone}"><div class="timeline-rail"><i></i></div><div><time>${formatDateTime(item.at)}</time><h3>${esc(item.title)}</h3><p>${esc(item.detail || 'Sem detalhes adicionais')}</p><small>${esc(item.user || 'Sistema')}</small></div></article>`).join('') : '<div class="empty"><b>Sem eventos para este veículo</b><span>As próximas marcações formarão a timeline.</span></div>';
  $('#timelineDialog').showModal();
}

function openVehicle(id = '') {
  const vehicle = state.vehicles.find(item => item.id === id);
  $('#vehicleForm').reset();
  $('#vehicleId').value = vehicle?.id || '';
  $('#dialogTitle').textContent = vehicle ? `Atualizar ${vehicle.plate}` : 'Registrar veículo no pátio';
  $('#plate').disabled = Boolean(vehicle);
  const fields = ['plate', 'brand', 'type', 'model', 'fleet', 'enteredAt', 'chassis', 'renavam', 'nf', 'operation', 'stage', 'status', 'yard', 'position', 'linkedPlates', 'notes'];
  fields.forEach(key => { if (vehicle) $(`#${key}`).value = vehicle[key] || ''; });
  if (!vehicle) { $('#enteredAt').value = localDateKey(); $('#status').value = 'No pátio'; $('#stage').value = 'Controle de pátio'; }
  $('#deleteVehicle').classList.toggle('hidden', !vehicle || state.user.role !== 'admin');
  $('#vehicleDialog').showModal();
}

function renderHistory() {
  $('#historyList').innerHTML = state.history.length ? state.history.map(event => `<div class="history-item"><time>${formatDateTime(event.at)}</time><span class="history-marker"></span><div><b>${esc(event.action)} · ${esc(event.plate)}</b><span>${esc(event.detail || [event.yard, event.position, event.status].filter(Boolean).join(' · ') || 'Sem detalhes')}</span><small>${esc(event.user)}</small></div></div>`).join('') : '<div class="empty"><b>Nenhum evento registrado</b></div>';
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active', item === button));
  $('#dailyView').classList.toggle('hidden', button.dataset.view !== 'daily');
  $('#weeklyView').classList.toggle('hidden', button.dataset.view !== 'weekly');
  if (button.dataset.view === 'weekly') renderWeekly();
}));
$('#loginForm').addEventListener('submit', async event => { event.preventDefault(); $('#loginError').textContent = ''; try { const data = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: $('#username').value, password: $('#password').value }) }); await enter(data.user); } catch (error) { $('#loginError').textContent = error.message; } });
$('#showPassword').onclick = () => { $('#password').type = $('#password').type === 'password' ? 'text' : 'password'; };
$('#logout').onclick = async () => { await request('/api/logout', { method: 'POST' }); loginScreen(); };
$('#newVehicle').onclick = () => openVehicle();
$('#yardTabs').onclick = event => { const button = event.target.closest('[data-yard]'); if (button) { activeYard = button.dataset.yard; renderYards(); renderVehicles(); } };
$('#search').oninput = renderVehicles;
$('#statusFilter').onchange = renderVehicles;
$('#vehicleTable').onclick = async event => {
  const presenceButton = event.target.closest('[data-presence-id]');
  if (presenceButton) {
    const present = presenceButton.dataset.present === 'true';
    const vehicle = state.vehicles.find(item => item.id === presenceButton.dataset.presenceId);
    if (!present && !confirm(`Confirmar que o veículo ${vehicle?.plate || ''} NÃO está no pátio? A permanência será encerrada agora.`)) return;
    presenceButton.disabled = true;
    presenceButton.textContent = '...';
    try { await request(`/api/vehicles/${presenceButton.dataset.presenceId}/presence-check`, { method: 'POST', body: JSON.stringify({ date: localDateKey(), present }) }); await load(); toast(present ? 'Presença confirmada. Nova permanência iniciada.' : 'Saída confirmada. Permanência encerrada.'); } catch (error) { presenceButton.disabled = false; presenceButton.textContent = present ? 'OK' : 'Não OK'; toast(error.message); }
    return;
  }
  const row = event.target.closest('[data-id]');
  if (row) openVehicle(row.dataset.id);
};
$('#vehicleTable').onkeydown = event => { if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('[data-presence-id]')) { const row = event.target.closest('[data-id]'); if (row) { event.preventDefault(); openVehicle(row.dataset.id); } } };
$('#previousWeek').onclick = () => { weekOffset -= 1; renderWeekly(); };
$('#currentWeek').onclick = () => { weekOffset = 0; renderWeekly(); };
$('#nextWeek').onclick = () => { weekOffset += 1; renderWeekly(); };
$('#weeklyVehicleFilter').onchange = () => renderWeeklyTable(weekDays());
$('#weeklyTable').onclick = event => { const row = event.target.closest('[data-timeline-id]'); if (row) openVehicleTimeline(row.dataset.timelineId); };
$('#weeklyTable').onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { const row = event.target.closest('[data-timeline-id]'); if (row) { event.preventDefault(); openVehicleTimeline(row.dataset.timelineId); } } };
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => $('#vehicleDialog').close());
$('#vehicleForm').addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('#vehicleId').value;
  const fields = ['plate', 'brand', 'type', 'model', 'fleet', 'enteredAt', 'chassis', 'renavam', 'nf', 'operation', 'stage', 'status', 'yard', 'position', 'linkedPlates', 'notes'];
  const payload = Object.fromEntries(fields.map(key => [key, $(`#${key}`).value]));
  try { await request(id ? `/api/vehicles/${id}` : '/api/vehicles', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); $('#vehicleDialog').close(); await load(); toast(id ? 'Movimentação registrada.' : 'Veículo registrado no pátio.'); } catch (error) { toast(error.message); }
});
$('#deleteVehicle').onclick = async () => { const id = $('#vehicleId').value; if (!id || !confirm('Excluir este veículo do controle? O histórico será preservado.')) return; try { await request(`/api/vehicles/${id}`, { method: 'DELETE' }); $('#vehicleDialog').close(); await load(); toast('Veículo excluído.'); } catch (error) { toast(error.message); } };
$('#historyButton').onclick = () => { renderHistory(); $('#historyDialog').showModal(); };
$('[data-close-history]').onclick = () => $('#historyDialog').close();
$('[data-close-timeline]').onclick = () => $('#timelineDialog').close();
$('#backupButton').onclick = async () => { try { const data = await request('/api/backup'); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `backup-patio-diversos-${localDateKey()}.json`; link.click(); URL.revokeObjectURL(link.href); toast('Backup gerado com sucesso.'); } catch (error) { toast(error.message); } };
$('#restoreButton').onclick = () => $('#restoreFile').click();
$('#restoreFile').onchange = async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file || !confirm(`Restaurar o backup “${file.name}”? Os dados atuais serão substituídos.`)) return; try { const content = JSON.parse(await file.text()); const result = await request('/api/backup/restore', { method: 'POST', body: JSON.stringify(content) }); await load(); toast(`Backup restaurado: ${result.vehicles} veículo(s).`); } catch (error) { toast(error.message); } };

function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
function updateInstallButton() { $('#installApp').classList.toggle('hidden', isStandalone()); }
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; updateInstallButton(); });
window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; $('#installApp').classList.add('hidden'); toast('App instalado com sucesso.'); });
$('#installApp').onclick = async () => { if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; updateInstallButton(); return; } toast('No menu do navegador, escolha “Instalar aplicativo”.'); };
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
updateInstallButton();
request('/api/me').then(data => enter(data.user)).catch(loginScreen);
