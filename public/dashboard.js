async function regenLink() {
	const resp = await fetch('/dashboard/widget/regenerate', { method: 'POST' });
	const data = await resp.json();
	document.getElementById('widgetLink').value = data.widgetUrl;
}

async function saveOptionsDraft() {
	const title = document.getElementById('title').value;
	const durationSec = document.getElementById('duration').value;
	const options = Array.from(document.querySelectorAll('.opt-input')).map(i => i.value).filter(Boolean);
	const resp = await fetch('/dashboard/options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, durationSec, options }) });
	const data = await resp.json();
	if (data.pollId) {
		window.currentPollId = data.pollId;
	}
	return data;
}

async function createPoll() {
	// Автосохранение при создании: если нет черновика, отправим raw options
	const title = document.getElementById('title').value;
	const durationSec = document.getElementById('duration').value;
	const options = Array.from(document.querySelectorAll('.opt-input')).map(i => i.value).filter(Boolean);
	const body = window.currentPollId ? { pollId: window.currentPollId } : { title, durationSec, options };
	const resp = await fetch('/dashboard/polls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	const data = await resp.json();
	if (data.ok) toast('Опрос создан на Twitch', 'success'); else toast('Ошибка: ' + (data.details || data.error), 'error', 4000);
}

function addOption() {
	const container = document.getElementById('options');
	const input = document.createElement('input');
	input.className = 'opt-input';
	input.placeholder = 'Вариант';
	container.appendChild(input);
}

document.addEventListener('DOMContentLoaded', () => {
	const btnCopy = document.getElementById('btnCopy');
	if (btnCopy) btnCopy.addEventListener('click', () => {
		navigator.clipboard.writeText(document.getElementById('widgetLink').value);
	});

	const btnRegen = document.getElementById('btnRegen');
	if (btnRegen) btnRegen.addEventListener('click', () => { regenLink(); });

	const btnAddOption = document.getElementById('btnAddOption');
	if (btnAddOption) btnAddOption.addEventListener('click', () => { addOption(); });

	const btnSaveTemplate = document.getElementById('btnSaveTemplate');
	if (btnSaveTemplate) btnSaveTemplate.addEventListener('click', () => { saveTemplate(); });

	const btnCreatePoll = document.getElementById('btnCreatePoll');
	if (btnCreatePoll) btnCreatePoll.addEventListener('click', () => { createPoll(); });

	loadTemplates();
});

async function saveTemplate() {
	const title = document.getElementById('title').value || 'Template';
	const durationSec = document.getElementById('duration').value;
	const options = Array.from(document.querySelectorAll('.opt-input')).map(i => i.value).filter(Boolean);
	if (options.length < 2) { alert('Нужно минимум 2 варианта'); return; }
	const resp = await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, options, durationSec }) });
	const data = await resp.json();
	if (data.ok) { loadTemplates(); toast('Шаблон сохранён'); } else { toast('Ошибка сохранения шаблона', 'error', 4000); }
}

async function loadTemplates() {
	try {
		const r = await fetch('/api/templates');
		const j = await r.json();
		const list = j.templates || [];
		const container = document.getElementById('templates');
		if (!container) return;
		container.innerHTML = '';
		list.forEach(t => {
			const wrap = document.createElement('div');
			wrap.style.display = 'flex';
			wrap.style.alignItems = 'center';
			wrap.style.gap = '6px';

			const btn = document.createElement('button');
			btn.className = 'btn';
			btn.textContent = t.title;
			btn.addEventListener('click', () => applyTemplate(t));

			const del = document.createElement('button');
			del.className = 'btn';
			del.textContent = '×';
			del.title = 'Удалить';
			del.style.background = '#b33';
			del.addEventListener('click', async (e) => {
				e.stopPropagation();
				await fetch(`/api/templates/${t.id}`, { method: 'DELETE' });
				loadTemplates();
			});

			wrap.appendChild(btn);
			wrap.appendChild(del);
			container.appendChild(wrap);
		});
	} catch (_) {}
}

function applyTemplate(t) {
	document.getElementById('title').value = t.title || '';
	if (t.durationSec) document.getElementById('duration').value = t.durationSec;
	const container = document.getElementById('options');
	container.innerHTML = '';
	(t.options || []).forEach(opt => {
		const input = document.createElement('input');
		input.className = 'opt-input';
		input.value = opt;
		container.appendChild(input);
	});
}


