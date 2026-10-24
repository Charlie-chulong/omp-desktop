// Executed only inside MONITOR_HTML's nonce-authorized static script.
export const MONITOR_RENDERER_SCRIPT = String.raw`
const bridge = window.ompMonitor;
let view = { language: 'en', compact: false, pinned: false, scope: { profile: null, project: null }, scopes: { profiles: [], projects: [] }, snapshot: null, workerError: false, refreshing: true, windowCount: 1, maxWindows: 8 };
let language = 'en', preferences = { orb: 'led', theme: 'vehicles', effects: 'low', language: null };
let formatters = {}, timeFormatters = {}, toastTimer = null, unsubscribe = null;
const moneyFormatters = new Map();
const translations = {
  zh: {
    brandSub:'本地信号 · 隐私优先',newWindow:'新窗口',export:'导出 CSV',compact:'悬浮',expand:'展开',refresh:'刷新',pin:'置顶',unpin:'取消置顶',close:'关闭监视器',privacyShort:'本地处理 · 可选公开价格 / 汇率下载',
    profile:'配置档',project:'项目',allProfiles:'全部配置档',allProjects:'全部项目',appearance:'外观与语言',orbStyle:'仪表样式',titleTheme:'速度称号主题',effects:'动效强度',effectsOff:'关闭',effectsLow:'低',effectsHigh:'高',language:'语言',effectsNote:'隐藏时暂停动效，并遵循系统减少动态效果设置。称号只是视觉趣味，不是模型评级。',
    liveWindow:'实时 · 最近 3 秒滑动窗口',aggregate:'合计输出速度',estimatedShare:'估算占比',measured:'实测',estimated:'估算',aggregateNote:'并发请求的输出吞吐相加；不是单次请求的生成速度。',visualScale:'仪表满刻度 1,000 tok/s · 数值不截顶',sessionPeak:'实测合计峰值',newPeak:'实测合计新峰值',
    todayInput:'今日 · 输入',todayOutput:'今日 · 输出',todayCache:'今日 · 缓存读 / 写',nativeTotal:'今日 · 原生总量',loggedTokens:'日志记录的 token',cacheNote:'原生 usage 的独立字段',nativeNote:'不是监视器重新相加的总量',requestsFailures:'请求 / 失败',failureNote:'仅限现存日志中已保留的结果',requestAverage:'请求平均速度',requestAverageNote:'实测输出 token ÷ 实测请求耗时',
    recordedCost:'OMP 日志已记费用 · USD',catalogCost:'当前价目表估算费用 · USD',unpriced:'条请求无已记价格',unestimated:'条请求无法匹配估价',catalogNote:'按当前价目表估算，非历史账单',fiveMinutes:'最近 5 分钟 · 合计输出吞吐',chartNote:'实线为有完整计时的日志事实；虚线为在途输出估算。不拦截 token 流。',
    resources:'本机原生 OMP 资源',cpu:'CPU · 全部逻辑核心容量',rss:'工作集 / RSS',privateMemory:'私有内存',processes:'进程数',resourceScope:'始终覆盖可识别的本机原生 OMP 进程，与当前配置档 / 项目筛选无关，不能归因到单个项目。各进程 RSS 之和不是唯一物理内存。',
    resource_available:'可用',resource_partial:'部分可用',resource_unavailable:'不可用',resource_no_processes:'未发现可识别的 OMP 进程。',resource_unsupported:'当前系统不支持此资源采样。',resource_unreadable:'部分进程无法读取。',resource_timeout:'采样超时；下一轮将恢复。',firstSample:'CPU 需要两个采样点；首次采样暂未知。',sampled:'采样于',
    agents:'主代理 · 子代理 · 顾问',agentRelation:'代理 / 父级',model:'模型',phase:'阶段',recentAverage:'近期请求均速',lastActivity:'最近活动',agentNote:'每行 tok/s 为该代理的实测请求均速，不是其在合计吞吐中的占比。TTFT 缺失表示未知，不是零。',kind_main:'主代理',kind_subagent:'子代理',kind_advisor:'顾问',phase_generating:'生成中',phase_tools:'工具阶段',phase_idle:'空闲',parent:'父级',
    history:'近 30 天现存日志历史',localDays:'按本地自然日',date:'日期',input:'输入',output:'输出',cache:'缓存读 / 写',total:'原生总量',loggedUsd:'已记 USD',estimatedUsd:'估算 USD',historyNote:'今天与之前 29 个本地自然日，仅统计当前磁盘可用日志。缺失、删除、轮换或不可读的日志不会被恢复；估价采用当前价目表。',
    publicData:'可选公开价格与汇率',allowNetwork:'允许更新公开数据',refreshPublic:'更新公开数据',currency:'显示币种',publicPrivacy:'仅匿名请求公开价格 / 汇率资源。不上传日志、模型查询、提示词、凭据或用量。所有费用仅供参考，不代表账单。',networkOff:'离线 · 使用本地数据',networkOn:'允许公开数据更新',
    feed_bundled:'内置',feed_fresh:'新鲜',feed_stale:'已过期',feed_error:'更新失败',feed_updating:'更新中',prices:'模型价格',rates:'汇率',dataDate:'数据日期',lastSuccess:'最近成功获取',neverFetched:'尚无在线成功记录',source:'来源',rateUnavailable:'汇率未知',noConversion:'USD 原币，不换算',conversionAsOf:'换算所用汇率数据日期',attribution:'数据归属',
    coverage:'覆盖范围与口径',timingExplanation:'请求速度为端到端输出 token / 请求耗时，包含首 token 等待时间（TTFT），不是纯解码速度。合计吞吐的实测和估算部分始终区分。',accountingExplanation:'OMP 已记 USD 费用只来自日志；无价格请求单独计数。价目表估算与币种换算不会覆盖已记 USD。原生 /stats 有自己的统计口径，这里不会再把它重复相加。',
    privacyExplanation:'该窗口仅保留数值用量、计时与安全标签，不保留或显示提示词、消息正文、凭据和原始会话路径，不解析其他代理。',footer:'只读日志 · 刷新可恢复 · 关闭最后一个窗口后停止采集',about:'关于与开源许可',
    status_scanning:'扫描中',status_ready:'已就绪',status_unavailable:'无可用日志目录',status_partial:'部分覆盖',status_error:'采集错误',workerError:'采集线程发生错误，保留的是上次数据。请点击刷新恢复；未显示任何原始错误或路径。',scanning:'正在扫描本地 OMP 日志；尚未完成的扫描不代表零用量。',
    unavailable:'未找到可用 OMP 日志目录，或目录尚无可读会话。启动 OMP 后可点击刷新重试。',partial:'当前结果不完整：部分文件未读取或命中资源上限。下方列出实际覆盖情况；刷新可重试。',snapshotError:'日志采集失败。请点击刷新恢复。',emptyAgents:'当前筛选下没有可显示的代理。',emptyHistory:'当前筛选下没有可用的近 30 天日志。',
    files:'文件',discovered:'发现',read:'已读',skipped:'跳过',malformed:'异常行',roots:'日志根目录',rootAvailable:'可用',rootMissing:'缺失或不可读',issue_unreadable:'部分文件不可读',issue_line_limit:'日志行限制',issue_file_limit:'文件数限制',issue_record_limit:'记录数限制',issue_scan_pending:'扫描尚未完成',limited:'已触发采集上限',
    unknown:'未知',now:'现在',minutesAgo:'分钟前',updated:'更新于',actionFailed:'操作未完成，请重试。',exportSaved:'CSV 已保存，包含当前筛选与覆盖信息。',exportUnavailable:'当前尚无可导出的快照。',exportFailed:'CSV 未能保存；未显示敏感文件路径。',bridgeError:'无法连接本地监视器，请关闭窗口后重新打开。',unavailableOption:'（当前不可用）'
  },
  en: {
    brandSub:'LOCAL SIGNAL · PRIVATE BY DESIGN',newWindow:'New window',export:'Export CSV',compact:'Compact',expand:'Expand',refresh:'Refresh',pin:'Pin',unpin:'Unpin',close:'Close monitor',privacyShort:'Local processing · Optional public price / FX downloads',
    profile:'Profile',project:'Project',allProfiles:'All profiles',allProjects:'All projects',appearance:'Appearance & language',orbStyle:'Instrument style',titleTheme:'Speed-title theme',effects:'Effects intensity',effectsOff:'Off',effectsLow:'Low',effectsHigh:'High',language:'Language',effectsNote:'Effects pause when hidden and respect reduced motion. Titles are decorative, not model ratings.',
    liveWindow:'Live · rolling 3-second window',aggregate:'Aggregate output throughput',estimatedShare:'Estimated fraction',measured:'Measured',estimated:'Estimated',aggregateNote:'Concurrent calls add together. This is not an individual request’s generation speed.',visualScale:'Visual full scale: 1,000 tok/s · numbers are not capped',sessionPeak:'Measured aggregate peak',newPeak:'NEW MEASURED PEAK',
    todayInput:'Today · input',todayOutput:'Today · output',todayCache:'Today · cache read / write',nativeTotal:'Today · native total',loggedTokens:'Logged tokens',cacheNote:'Separate native usage fields',nativeNote:'Not a sum reconstructed by this monitor',requestsFailures:'Requests / failures',failureNote:'Only outcomes retained in available logs',requestAverage:'Request-average speed',requestAverageNote:'Measured output ÷ measured request time',
    recordedCost:'Recorded OMP cost · USD',catalogCost:'Catalog-estimated cost · USD',unpriced:'requests without recorded prices',unestimated:'requests without catalog estimates',catalogNote:'Current catalog estimate, not a historical bill',fiveMinutes:'Last 5 minutes · aggregate output',chartNote:'Solid = completed, timed log facts. Dashed = estimated in-flight output. No token streaming is intercepted.',
    resources:'Local native OMP resources',cpu:'CPU · total logical capacity',rss:'Working set / RSS',privateMemory:'Private memory',processes:'Processes',resourceScope:'All identifiable local native OMP processes, regardless of the selected profile/project. Not attributable to a particular project. Summed RSS is not unique physical memory.',
    resource_available:'Available',resource_partial:'Partially available',resource_unavailable:'Unavailable',resource_no_processes:'No identifiable OMP processes found.',resource_unsupported:'Resource sampling is unsupported on this system.',resource_unreadable:'Some processes could not be read.',resource_timeout:'Sampling timed out; the next cycle can recover.',firstSample:'CPU needs two samples; the first sample is unknown.',sampled:'Sampled',
    agents:'Main agents · subagents · advisors',agentRelation:'Agent / parent',model:'Model',phase:'Phase',recentAverage:'Recent request avg.',lastActivity:'Last activity',agentNote:'Each row’s tok/s is that agent’s measured request average, not its share of aggregate throughput. Missing TTFT is unknown, never zero.',kind_main:'Main',kind_subagent:'Subagent',kind_advisor:'Advisor',phase_generating:'Generating',phase_tools:'Tools',phase_idle:'Idle',parent:'Parent',
    history:'30-day available-log history',localDays:'Local calendar dates',date:'Date',input:'Input',output:'Output',cache:'Cache R / W',total:'Native total',loggedUsd:'Recorded USD',estimatedUsd:'Estimated USD',historyNote:'Today and the previous 29 local dates, from logs currently available on disk. Missing, deleted, rotated or unreadable logs are not recovered. Estimates use the current catalog.',
    publicData:'Optional public prices & exchange rates',allowNetwork:'Allow public-data updates',refreshPublic:'Refresh public data',currency:'Display currency',publicPrivacy:'Only anonymous public price/rate assets are requested. No logs, model queries, prompts, credentials or usage data are uploaded. All costs are informational, not a bill.',networkOff:'Offline · using local data',networkOn:'Public-data updates allowed',
    feed_bundled:'Bundled',feed_fresh:'Fresh',feed_stale:'Stale',feed_error:'Update failed',feed_updating:'Updating',prices:'Model prices',rates:'Exchange rates',dataDate:'Data date',lastSuccess:'Last successful fetch',neverFetched:'No successful online fetch yet',source:'Source',rateUnavailable:'Exchange rate unknown',noConversion:'Original USD · no conversion',conversionAsOf:'Exchange-rate data date',attribution:'Attribution',
    coverage:'Coverage & interpretation',timingExplanation:'Request speed is end-to-end output tokens / request time, including time to first token (TTFT); it is not pure decoder speed. Measured and estimated aggregate throughput remain distinct.',accountingExplanation:'Recorded OMP USD cost comes only from log records; unpriced calls are counted separately. Catalog estimates and currency conversion never overwrite recorded USD. Native /stats uses its own accounting and is not added again here.',
    privacyExplanation:'This window keeps numeric usage, timing and safe labels only. It neither retains nor displays prompts, message bodies, credentials or raw transcript paths. It does not parse other agents.',footer:'Read-only logs · Refresh to recover · Close the last window to stop collection',about:'About & open-source license',
    status_scanning:'Scanning',status_ready:'Ready',status_unavailable:'No available log roots',status_partial:'Partial coverage',status_error:'Collection error',workerError:'The collector encountered an error. Any displayed values are from the last snapshot. Refresh to recover; raw errors and paths are never shown.',scanning:'Scanning local OMP logs. An unfinished scan does not mean zero usage.',
    unavailable:'No usable OMP log roots or readable sessions were found. Start OMP and refresh to retry.',partial:'Results are incomplete: some files were unreadable or a resource limit was reached. Actual coverage is shown below; refresh to retry.',snapshotError:'Log collection failed. Refresh to recover.',emptyAgents:'No agents are available for this selection.',emptyHistory:'No logs are available for these dates and filters.',
    files:'Files',discovered:'discovered',read:'read',skipped:'skipped',malformed:'malformed lines',roots:'Log roots',rootAvailable:'available',rootMissing:'missing or unreadable',issue_unreadable:'Unreadable files',issue_line_limit:'Log-line limit',issue_file_limit:'File count limit',issue_record_limit:'Record count limit',issue_scan_pending:'Scan pending',limited:'Collection limits reached',
    unknown:'Unknown',now:'Now',minutesAgo:'min ago',updated:'Updated',actionFailed:'The action could not be completed. Please retry.',exportSaved:'CSV saved with the current selection and coverage.',exportUnavailable:'No snapshot is available to export yet.',exportFailed:'The CSV could not be saved. Sensitive file paths are not shown.',bridgeError:'Could not connect to the local monitor. Close this window and open it again.',unavailableOption:'(currently unavailable)'
  }
};
function t(key) { return translations[language][key] || translations.en[key] || key; }
function setText(id, value) { document.getElementById(id).textContent = String(value); }
function finite(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
function number(value, digits = 0) { const n = finite(value); return n === null ? '—' : formatters[digits].format(n); }
function percent(value) { const n = finite(value); return n === null ? '—' : number(Math.min(1, n) * 100, 1) + '%'; }
function timestamp(value, date = false) {
  const n = finite(value); if (n === null || !n) return '—';
  const parsed = new Date(n); if (!Number.isFinite(parsed.getTime())) return '—';
  return (date ? timeFormatters.full : timeFormatters.time).format(parsed);
}
function money(value, currency = 'USD') {
  const n = finite(value); if (n === null) return '—';
  const code = /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  let formatter = moneyFormatters.get(code);
  if (!formatter) {
    formatter = new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en-US', { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 4 });
    moneyFormatters.set(code, formatter);
  }
  return formatter.format(n);
}
function dateLabel(value) {
  if (!value) return t('unknown');
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? timeFormatters.date.format(parsed) : String(value);
}
function applyLanguage() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  formatters = { 0: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), 1: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), 2: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }) };
  timeFormatters = { time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }), full: new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }), date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }) };
  moneyFormatters.clear();
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  document.getElementById('close').setAttribute('aria-label', t('close'));
  document.getElementById('profile').setAttribute('aria-label', t('profile'));
  document.getElementById('project').setAttribute('aria-label', t('project'));
  document.getElementById('rate-chart').setAttribute('aria-label', t('fiveMinutes'));
  for (const id of ['orb-style','title-theme','effects','language']) document.getElementById(id).setAttribute('aria-label', t({ 'orb-style':'orbStyle','title-theme':'titleTheme',effects:'effects',language:'language' }[id]));
  fillAppearance();
}
function loadPreferences() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('omp.monitor.view') || localStorage.getItem('omp.monitor.defaults') || '{}');
    if (Object.hasOwn(visualPresets, saved.orb)) preferences.orb = saved.orb;
    if (Object.hasOwn(titlePresets, saved.theme)) preferences.theme = saved.theme;
    if (['off','low','high'].includes(saved.effects)) preferences.effects = saved.effects;
    if (['zh','en'].includes(saved.language)) preferences.language = saved.language;
  } catch { /* Storage may be unavailable; the monitor remains fully functional. */ }
}
function savePreferences() {
  preferences.language = language;
  try { sessionStorage.setItem('omp.monitor.view', JSON.stringify(preferences)); localStorage.setItem('omp.monitor.defaults', JSON.stringify(preferences)); } catch { /* Optional safe presentation preferences only. */ }
}
function fillAppearance() {
  for (const [id, values, selected] of [['orb-style',visualPresets,preferences.orb],['title-theme',titlePresets,preferences.theme]]) {
    const select = document.getElementById(id), fragment = document.createDocumentFragment();
    for (const [key, value] of Object.entries(values)) {
      const option = document.createElement('option'); option.value = key;
      const labels = Array.isArray(value) ? value : value.name; option.textContent = labels[language === 'zh' ? 0 : 1]; fragment.append(option);
    }
    select.replaceChildren(fragment); select.value = selected;
  }
  document.getElementById('effects').value = preferences.effects;
  document.getElementById('language').value = language;
}
function fillScope(id, values, selected, allLabel) {
  const select = document.getElementById(id);
  if (document.activeElement === select && select.options.length) return;
  const fragment = document.createDocumentFragment(), all = document.createElement('option');
  all.value = ''; all.textContent = t(allLabel); fragment.append(all);
  for (const value of values) { const option = document.createElement('option'); option.value = value; option.textContent = value; fragment.append(option); }
  if (selected !== null && !values.includes(selected)) { const option = document.createElement('option'); option.value = selected; option.textContent = selected + ' ' + t('unavailableOption'); fragment.append(option); }
  select.replaceChildren(fragment); select.value = selected === null ? '' : selected;
}
function toast(message) {
  clearTimeout(toastTimer); setText('toast', message);
  toastTimer = setTimeout(() => { setText('toast',''); toastTimer = null; }, 4200);
}
async function action(work) { try { await work(); } catch { toast(t('actionFailed')); } }
function renderView() {
  const snapshot = view.snapshot, status = view.workerError ? 'error' : view.refreshing ? 'scanning' : snapshot ? snapshot.status : 'scanning';
  const facts = snapshot && !['unavailable','error'].includes(snapshot.status) && !(snapshot.status === 'scanning' && snapshot.coverage.readFiles === 0) ? snapshot : null;
  document.body.dataset.compact = String(view.compact);
  const compact = document.getElementById('compact'), pin = document.getElementById('pin');
  compact.textContent = t(view.compact ? 'expand' : 'compact'); compact.setAttribute('aria-label', compact.textContent);
  pin.textContent = t(view.pinned ? 'unpin' : 'pin'); pin.setAttribute('aria-pressed', String(view.pinned)); pin.setAttribute('aria-label', pin.textContent);
  document.getElementById('new-window').disabled = view.windowCount >= view.maxWindows;
  document.getElementById('export').disabled = !facts;
  document.getElementById('refresh').setAttribute('aria-busy', String(view.refreshing));
  for (const id of ['coverage-status','compact-status']) { const node = document.getElementById(id); node.dataset.status = status; node.textContent = t('status_' + status); }
  setText('compact-scope', (view.scope.profile || t('allProfiles')) + ' · ' + (view.scope.project || t('allProjects')));
  setText('selected-scope', t('profile') + ': ' + (view.scope.profile || t('allProfiles')) + ' · ' + t('project') + ': ' + (view.scope.project || t('allProjects')));
  setText('compact-estimate', t('estimatedShare') + ' ' + percent(facts ? facts.rate.estimatedShare : null) + (view.workerError ? ' · ' + t('feed_stale') : ''));
  renderInstrument(facts);
  if (view.compact || document.hidden) return;
  fillScope('profile', view.scopes.profiles, view.scope.profile, 'allProfiles');
  fillScope('project', view.scopes.projects, view.scope.project, 'allProjects');
  const banner = document.getElementById('banner');
  banner.hidden = status === 'ready'; banner.dataset.error = String(status === 'error');
  banner.textContent = view.workerError ? t('workerError') : t(status === 'error' ? 'snapshotError' : status);
  const usage = facts ? facts.today : null;
  for (const [id,key] of [['today-input','inputTokens'],['today-output','outputTokens'],['today-total','totalTokens']]) setText(id, number(usage ? usage[key] : null));
  setText('today-cache', usage ? number(usage.cacheReadTokens) + ' / ' + number(usage.cacheWriteTokens) : '—');
  setText('today-requests', usage ? number(usage.requests) + ' / ' + number(usage.failedRequests) : '—');
  const average = usage && finite(usage.measuredDurationMs) > 0 && finite(usage.measuredOutputTokens) !== null ? usage.measuredOutputTokens * 1000 / usage.measuredDurationMs : null;
  setText('today-average', number(average, 1));
  const recorded = usage && !(usage.requests > 0 && usage.unpricedRequests >= usage.requests) ? usage.costUsd : null;
  const estimated = usage && !(usage.requests > 0 && usage.unestimatedRequests >= usage.requests) ? usage.estimatedCostUsd : null;
  setText('today-cost', money(recorded)); setText('catalog-cost', money(estimated));
  setText('today-unpriced', usage ? number(usage.unpricedRequests) + ' ' + t('unpriced') : t('unknown'));
  setText('catalog-note', (usage ? number(usage.unestimatedRequests) + ' ' + t('unestimated') + ' · ' : '') + t('catalogNote'));
  renderPublicData(snapshot ? snapshot.pricing : null, recorded, estimated);
  renderChart(facts);
  renderResources(snapshot ? snapshot.resources : null);
  renderAgents(facts ? facts.agents : []);
  renderHistory(facts ? facts.days : []);
  renderCoverage(snapshot);
}
function renderChart(snapshot) {
  const root = document.getElementById('rate-chart-content'), fragment = document.createDocumentFragment();
  const end = snapshot && finite(snapshot.updatedAt) !== null ? snapshot.updatedAt : Date.now(), start = end - 300000;
  const points = snapshot ? snapshot.series.filter(point => finite(point.timestamp) !== null && point.timestamp >= start && point.timestamp <= end).slice(-320) : [];
  let maximum = 1;
  for (const point of points) maximum = Math.max(maximum, finite(point.measuredTps) || 0, finite(point.estimatedTps) || 0);
  const width = 754, height = 106, left = 48, top = 8;
  for (let i = 0; i < 3; i++) {
    const y = top + height * i / 2;
    const line = document.createElementNS(svgNamespace, 'line'); line.setAttribute('x1', String(left)); line.setAttribute('x2', '802'); line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y)); line.setAttribute('class', 'chart-grid'); fragment.append(line);
    const label = document.createElementNS(svgNamespace, 'text'); label.setAttribute('x', '40'); label.setAttribute('y', String(y + 3)); label.setAttribute('text-anchor', 'end'); label.setAttribute('class', 'chart-label'); label.textContent = number(maximum * (1 - i / 2), 1); fragment.append(label);
  }
  for (const [key,className] of [['measuredTps','chart-measured'],['estimatedTps','chart-estimated']]) {
    let path = '', segment = false;
    for (const point of points) { const value = finite(point[key]); if (value === null) { segment = false; continue; } const x = left + (point.timestamp - start) / 300000 * width, y = top + height * (1 - Math.min(maximum, value) / maximum); path += (segment ? ' L ' : ' M ') + x.toFixed(2) + ' ' + y.toFixed(2); segment = true; }
    const node = document.createElementNS(svgNamespace, 'path'); node.setAttribute('d', path); node.setAttribute('class', className); fragment.append(node);
  }
  for (const [x, label, anchor] of [[48,'5 ' + t('minutesAgo'),'start'],[425,'2.5 ' + t('minutesAgo'),'middle'],[802,t('now'),'end']]) { const node = document.createElementNS(svgNamespace, 'text'); node.setAttribute('x', String(x)); node.setAttribute('y','138'); node.setAttribute('text-anchor', anchor); node.setAttribute('class','chart-axis'); node.textContent = label; fragment.append(node); }
  root.replaceChildren(fragment);
}
function renderResources(resources) {
  setText('resource-status', resources ? t('resource_' + resources.status) : t('unknown'));
  setText('resource-cpu', resources && finite(resources.cpuPercent) !== null ? number(resources.cpuPercent, 1) + '%' : '—');
  setText('resource-rss', resources && finite(resources.workingSetBytes) !== null ? number(resources.workingSetBytes / 1048576, 1) + ' MB' : '—');
  setText('resource-private', resources && finite(resources.privateBytes) !== null ? number(resources.privateBytes / 1048576, 1) + ' MB' : '—');
  setText('resource-count', resources ? number(resources.status === 'unavailable' && resources.reason !== 'no_processes' ? null : resources.processCount) : '—');
  const notes = [];
  if (resources) { if (resources.reason) notes.push(t('resource_' + resources.reason)); if (resources.cpuPercent === null && resources.processCount > 0 && resources.status !== 'unavailable') notes.push(t('firstSample')); if (resources.sampledAt) notes.push(t('sampled') + ' ' + timestamp(resources.sampledAt)); }
  setText('resource-note', notes.join(' · '));
}
function tableCell(row, value, className = '') {
  const cell = document.createElement('td'); cell.textContent = String(value); if (className) cell.className = className; row.append(cell); return cell;
}
function renderAgents(agents) {
  const fragment = document.createDocumentFragment(), names = new Map(agents.map(agent => [agent.id, agent.name]));
  for (const agent of agents) {
    const row = document.createElement('tr'), label = tableCell(row, agent.name || agent.id, 'label-cell');
    const relation = document.createElement('span'); relation.className = 'secondary';
    relation.textContent = t('kind_' + agent.kind) + (agent.parentId ? ' · ' + t('parent') + ': ' + (names.get(agent.parentId) || agent.parentId) : ''); label.append(relation);
    tableCell(row, agent.project || '—', 'label-cell'); tableCell(row, agent.profile || '—'); tableCell(row, agent.model || '—', 'label-cell');
    const phaseCell = tableCell(row, ''), phase = document.createElement('span'); phase.className = 'phase ' + (['generating','tools','idle'].includes(agent.phase) ? agent.phase : 'idle'); phase.textContent = t('phase_' + agent.phase); phaseCell.append(phase);
    tableCell(row, number(agent.outputTps, 1) + (finite(agent.outputTps) !== null ? ' tok/s' : ''), 'number');
    tableCell(row, finite(agent.ttftMs) === null ? '—' : number(agent.ttftMs / 1000, 2) + ' s', 'number'); tableCell(row, timestamp(agent.lastActivityAt)); fragment.append(row);
  }
  document.getElementById('agent-rows').replaceChildren(fragment); setText('agent-count', number(agents.length));
  const empty = document.getElementById('agents-empty'); empty.hidden = agents.length > 0; empty.textContent = t('emptyAgents');
}
function renderHistory(days) {
  const fragment = document.createDocumentFragment();
  for (const day of days.slice(-30).reverse()) {
    const row = document.createElement('tr'); tableCell(row, day.date);
    for (const key of ['inputTokens','outputTokens']) tableCell(row, number(day[key]), 'number');
    tableCell(row, number(day.cacheReadTokens) + ' / ' + number(day.cacheWriteTokens), 'number'); tableCell(row, number(day.totalTokens), 'number');
    tableCell(row, number(day.requests) + ' / ' + number(day.failedRequests), 'number');
    const recorded = day.requests > 0 && day.unpricedRequests >= day.requests ? null : day.costUsd;
    const estimated = day.requests > 0 && day.unestimatedRequests >= day.requests ? null : day.estimatedCostUsd;
    const recordedCell = tableCell(row, money(recorded), 'number'), estimatedCell = tableCell(row, money(estimated), 'number');
    for (const [cell,count,key] of [[recordedCell,day.unpricedRequests,'unpriced'],[estimatedCell,day.unestimatedRequests,'unestimated']]) {
      if (count > 0) { const note = document.createElement('span'); note.className = 'secondary'; note.textContent = number(count) + ' ' + t(key); cell.append(note); }
    }
    fragment.append(row);
  }
  document.getElementById('history-rows').replaceChildren(fragment);
  const empty = document.getElementById('history-empty'); empty.hidden = days.length > 0; empty.textContent = t('emptyHistory');
}
function renderCoverage(snapshot) {
  if (!snapshot) { setText('coverage-details', t('scanning')); setText('updated-at',''); return; }
  const coverage = snapshot.coverage;
  const roots = coverage.roots.map(root => root.label + ': ' + t(root.available ? 'rootAvailable' : 'rootMissing')).join(' · ');
  const counts = t('files') + ': ' + number(coverage.discoveredFiles) + ' ' + t('discovered') + ' / ' + number(coverage.readFiles) + ' ' + t('read') + ' / ' + number(coverage.skippedFiles) + ' ' + t('skipped') + ' · ' + number(coverage.malformedLines) + ' ' + t('malformed');
  const issues = coverage.issues.map(issue => t('issue_' + issue)); if (coverage.limited) issues.push(t('limited'));
  setText('coverage-details', t('roots') + ': ' + (roots || t('unknown')) + '\n' + counts + (issues.length ? '\n' + issues.join(' · ') : ''));
  setText('updated-at', t('updated') + ' ' + timestamp(snapshot.updatedAt));
}
function renderPublicData(pricing, recorded, estimated) {
  const enabled = document.getElementById('network-enabled'), refresh = document.getElementById('public-refresh'), currency = document.getElementById('currency');
  enabled.disabled = !pricing; refresh.disabled = !pricing || !pricing.networkEnabled || pricing.prices.status === 'updating' || pricing.rates.status === 'updating'; currency.disabled = !pricing;
  enabled.checked = !!(pricing && pricing.networkEnabled);
  if (!pricing) { setText('public-status', t('unknown')); setText('public-details', t('scanning')); setText('recorded-converted',''); setText('catalog-converted',''); return; }
  if (document.activeElement !== currency || !currency.options.length) {
    const fragment = document.createDocumentFragment();
    for (const code of pricing.currencies) { const option = document.createElement('option'); option.value = code; option.textContent = code; fragment.append(option); }
    currency.replaceChildren(fragment); currency.value = pricing.currency;
  }
  setText('public-status', t(pricing.networkEnabled ? 'networkOn' : 'networkOff'));
  const lines = [];
  for (const [key,feed] of [['prices',pricing.prices],['rates',pricing.rates]]) {
    lines.push(t(key) + ': ' + t('feed_' + feed.status) + ' · ' + t('dataDate') + ': ' + dateLabel(feed.updatedAt) + ' · ' + t('lastSuccess') + ': ' + (feed.fetchedAt ? timestamp(feed.fetchedAt, true) : t('neverFetched')) + ' · ' + t('source') + ': ' + feed.source + (feed.version ? ' [' + feed.version + ']' : ''));
  }
  if (pricing.attribution) lines.push(t('attribution') + ': ' + pricing.attribution.label + ' · ' + pricing.attribution.url);
  setText('public-details', lines.join('\n'));
  for (const [id,value] of [['recorded-converted',recorded],['catalog-converted',estimated]]) {
    if (pricing.currency === 'USD') setText(id, t('noConversion'));
    else if (finite(pricing.exchangeRate) === null) setText(id, pricing.currency + ': ' + t('rateUnavailable'));
    else setText(id, money(value === null ? null : value * pricing.exchangeRate, pricing.currency) + ' · ' + t('conversionAsOf') + ' ' + dateLabel(pricing.rates.updatedAt));
  }
}
function receiveState(next) {
  const scopeChanged = next.scope.profile !== view.scope.profile || next.scope.project !== view.scope.project;
  view = next;
  if (scopeChanged) { sessionPeak = 0; hasLiveSample = false; lastPeakSnapshotAt = 0; clearTimeout(peakTimer); document.getElementById('hero').classList.remove('peak'); }
  if (!preferences.language && language !== next.language) { language = next.language; applyLanguage(); }
  if (document.hidden && next.snapshot && next.snapshot.status === 'ready' && !next.workerError && next.snapshot.updatedAt > lastPeakSnapshotAt) {
    const peak = finite(next.snapshot.today.peakOutputTps);
    if (peak !== null) { sessionPeak = peak; hasLiveSample = true; lastPeakSnapshotAt = next.snapshot.updatedAt; }
  }
  if (!document.hidden) renderView();
}
function startMonitor() {
  loadPreferences(); language = preferences.language || 'en'; applyLanguage(); renderView();
  setText('about-attribution', monitorAttribution);
  setText('about-license', monitorLicense);
  if (!bridge) { const banner = document.getElementById('banner'); banner.hidden = false; banner.dataset.error = 'true'; banner.textContent = t('bridgeError'); return; }
  unsubscribe = bridge.onState(receiveState);
  bridge.ready().then(receiveState).catch(() => { view.workerError = true; renderView(); toast(t('bridgeError')); });
  document.getElementById('refresh').addEventListener('click', () => action(() => bridge.refresh()));
  document.getElementById('compact').addEventListener('click', () => action(() => bridge.setCompact(!view.compact)));
  document.getElementById('pin').addEventListener('click', () => action(() => bridge.setPinned(!view.pinned)));
  document.getElementById('close').addEventListener('click', () => action(() => bridge.close()));
  document.getElementById('new-window').addEventListener('click', () => action(() => bridge.newWindow()));
  document.getElementById('export').addEventListener('click', () => action(async () => { const result = await bridge.exportCsv(); if (result !== 'cancelled') toast(t(result === 'saved' ? 'exportSaved' : result === 'unavailable' ? 'exportUnavailable' : 'exportFailed')); }));
  for (const id of ['profile','project']) document.getElementById(id).addEventListener('change', () => action(() => bridge.setScope({ profile: document.getElementById('profile').value || null, project: document.getElementById('project').value || null })));
  document.getElementById('orb-style').addEventListener('change', event => { preferences.orb = event.target.value; savePreferences(); renderView(); });
  document.getElementById('title-theme').addEventListener('change', event => { preferences.theme = event.target.value; savePreferences(); renderView(); });
  document.getElementById('effects').addEventListener('change', event => { preferences.effects = event.target.value; savePreferences(); renderView(); });
  document.getElementById('language').addEventListener('change', event => { language = event.target.value; savePreferences(); applyLanguage(); renderView(); });
  document.getElementById('network-enabled').addEventListener('change', event => action(() => bridge.setNetworkEnabled(event.target.checked)));
  document.getElementById('public-refresh').addEventListener('click', () => action(() => bridge.refreshPublicData()));
  document.getElementById('currency').addEventListener('change', event => action(() => bridge.setCurrency(event.target.value)));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderView(); });
  window.addEventListener('pagehide', () => { if (unsubscribe) unsubscribe(); clearTimeout(toastTimer); });
}
`;
