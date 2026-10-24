// Static renderer code only. Speed-title thresholds/translations are adapted from
// zoefix/agent-speed (MIT), SpeedTitle.cs and spec/strings.json; see repository attribution.
export const MONITOR_VISUALS_SCRIPT = String.raw`
const visualPresets = {
  led: ['LED 仪表', 'LED Gauge'], needle: ['指针转速表', 'Needle Tachometer'],
  liquid: ['液态能量', 'Liquid Energy'], reactor: ['反应堆', 'Reactor'], minimal: ['极简圆环', 'Minimal Ring']
};
const titlePresets = {
  vehicles: { name: ['交通工具', 'Vehicles'], zh: ['待机','步行','自行车','电动车','摩托车','汽车','跑车','高铁','赛车','磁悬浮列车','喷气客机','战斗机','高超音速飞机','火箭'], en: ['Idle','Walking','Bicycle','E-Bike','Motorcycle','Car','Sports Car','Bullet Train','Race Car','Maglev','Jetliner','Fighter Jet','Hypersonic','Rocket'] },
  animals: { name: ['动物', 'Animals'], zh: ['打盹','蜗牛','乌龟','刺猬','老鼠','松鼠','猫','兔子','袋鼠','马','猎豹','蝙蝠','金雕','游隼'], en: ['Napping','Snail','Tortoise','Hedgehog','Mouse','Squirrel','Cat','Rabbit','Kangaroo','Horse','Cheetah','Bat','Eagle','Falcon'] },
  wind: { name: ['蒲福风级', 'Beaufort Scale'], zh: ['风平浪静','无风','软风','轻风','微风','和风','清劲风','强风','疾风','大风','烈风','狂风','暴风','飓风'], en: ['Becalmed','Force 0','Force 1','Force 2','Force 3','Force 4','Force 5','Force 6','Force 7','Force 8','Force 9','Force 10','Force 11','Force 12'] },
  space: { name: ['宇宙', 'Cosmos'], zh: ['休眠','星尘','流星','彗星','月球','行星','恒星','红巨星','超新星','中子星','黑洞','星系','类星体','大爆炸'], en: ['Dormant','Stardust','Meteor','Comet','Moon','Planet','Star','Red Giant','Supernova','Pulsar','Black Hole','Galaxy','Quasar','Big Bang'] },
  cultivation: { name: ['修真境界', 'Cultivation'], zh: ['闭关','凡人','炼气','筑基','金丹','元婴','化神','炼虚','合体','大乘','渡劫','真仙','金仙','道祖'], en: ['Seclusion','Mortal','Qi Refining','Foundation','Gold Core','Nascent','Spirit','Void','Integration','Mahayana','Tribulation','Immortal','Celestial','Dao Lord'] },
  wuxia: { name: ['武学境界', 'Martial Arts'], zh: ['打坐','初学乍练','粗通皮毛','略知一二','渐入佳境','略有小成','驾轻就熟','融会贯通','炉火纯青','出类拔萃','出神入化','登峰造极','一代宗师','天下无双'], en: ['At Rest','Novice','Dabbler','Learner','Promising','Capable','Skilled','Adept','Expert','Elite','Virtuoso','Paragon','Legend','Peerless'] },
  mage: { name: ['魔法位阶', 'Arcane Ranks'], zh: ['冥想','学徒','见习法师','法师','大法师','魔导师','大魔导师','贤者','大贤者','传奇','半神','神','主神','创世神'], en: ['Meditating','Novice','Apprentice','Mage','High Mage','Magus','Archmage','Sage','Great Sage','Legend','Demigod','Deity','High God','Creator'] },
  gameRank: { name: ['游戏段位', 'Game Ranks'], zh: ['挂机','菜鸟','黑铁','青铜','白银','黄金','铂金','翡翠','钻石','大师','宗师','王者','传奇','榜首'], en: ['AFK','Rookie','Iron','Bronze','Silver','Gold','Platinum','Emerald','Diamond','Master','Elite','Champion','Legend','#1'] },
  engineer: { name: ['工程师生涯', 'Engineer Career'], zh: ['下班','实习生','初级工程师','工程师','资深工程师','技术主管','主任工程师','架构师','首席工程师','技术总监','技术副总','CTO','传奇工程师','10x 工程师'], en: ['Off Duty','Intern','Junior','Engineer','Senior','Tech Lead','Staff','Architect','Principal','Director','VP Eng','CTO','Legend','10x Dev'] }
};
const titleThresholds = [0, .5, 20, 30, 40, 60, 80, 120, 170, 240, 340, 500, 700, 1000];
const svgNamespace = 'http://www.w3.org/2000/svg';
const ledTicks = [];
for (let index = 0; index < 44; index++) {
  const angle = (-225 + index * 270 / 43) * Math.PI / 180;
  const tick = document.createElementNS(svgNamespace, 'line');
  tick.setAttribute('x1', String(130 + 103 * Math.cos(angle)));
  tick.setAttribute('y1', String(130 + 103 * Math.sin(angle)));
  tick.setAttribute('x2', String(130 + 113 * Math.cos(angle)));
  tick.setAttribute('y2', String(130 + 113 * Math.sin(angle)));
  tick.setAttribute('class', 'led-tick');
  document.getElementById('led-ticks').append(tick);
  ledTicks.push(tick);
}
for (let index = 0; index <= 20; index++) {
  const angle = (-225 + index * 270 / 20) * Math.PI / 180;
  const tick = document.createElementNS(svgNamespace, 'line');
  const radius = index % 5 === 0 ? 94 : 101;
  tick.setAttribute('x1', String(130 + radius * Math.cos(angle)));
  tick.setAttribute('y1', String(130 + radius * Math.sin(angle)));
  tick.setAttribute('x2', String(130 + 112 * Math.cos(angle)));
  tick.setAttribute('y2', String(130 + 112 * Math.sin(angle)));
  tick.setAttribute('class', index % 5 === 0 ? 'needle-major' : 'needle-minor');
  document.getElementById('needle-ticks').append(tick);
}
let sessionPeak = 0, hasLiveSample = false, lastPeakSnapshotAt = 0, peakTimer = null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function syncEffects() {
  document.body.dataset.hidden = String(document.hidden);
  document.body.dataset.effects = reducedMotion.matches ? 'off' : preferences.effects;
  if (document.hidden || reducedMotion.matches || preferences.effects === 'off') {
    clearTimeout(peakTimer);
    peakTimer = null;
    document.getElementById('hero').classList.remove('peak');
  }
}
function renderInstrument(snapshot) {
  const measured = snapshot ? finite(snapshot.rate.measuredTps) : null;
  const estimated = snapshot ? finite(snapshot.rate.estimatedTps) : null;
  const measuredPeak = snapshot ? finite(snapshot.today.peakOutputTps) : null;
  const value = measured === null || estimated === null ? null : finite(measured + estimated);
  const heat = value === null ? 0 : Math.min(1, Math.pow(value / 1000, .6));
  const share = snapshot ? finite(snapshot.rate.estimatedShare) : null;
  const estimatedPart = share === null ? 0 : Math.max(0, Math.min(1, share));
  let level = 0;
  for (let i = 1; i < titleThresholds.length; i++) if (value !== null && value >= titleThresholds[i]) level = i;
  document.body.dataset.orb = preferences.orb;
  document.body.dataset.tier = String(value === null || value < .5 ? 0 : value < 120 ? 1 : value < 500 ? 2 : 3);
  document.body.dataset.active = String(value !== null && value >= .5 && !view.workerError);
  setText('speed-value', number(value, 1));
  setText('speed-title', value === null ? t('unknown') : titlePresets[preferences.theme][language][level]);
  setText('estimated-fraction', share === null ? t('unknown') : percent(share));
  setText('measured-speed', number(measured, 1));
  setText('estimated-speed', number(estimated, 1));
  setText('session-peak', number(measuredPeak, 1));
  document.getElementById('instrument').setAttribute('aria-label', t('aggregate') + ': ' + number(value, 1) + ' tok/s; ' + t('estimatedShare') + ': ' + percent(share));
  for (let i = 0; i < ledTicks.length; i++) ledTicks[i].classList.toggle('lit', value !== null && value > 0 && i / ledTicks.length < heat);
  document.getElementById('needle-hand').setAttribute('transform', 'rotate(' + (-135 + heat * 270).toFixed(2) + ' 130 130)');
  document.getElementById('liquid-fill').setAttribute('y', String(228 - heat * 196));
  document.getElementById('liquid-fill').setAttribute('height', String(heat * 196));
  document.getElementById('liquid-wave').setAttribute('transform', 'translate(0 ' + (228 - heat * 196).toFixed(2) + ')');
  document.getElementById('reactor-energy').setAttribute('stroke-dasharray', (heat * 100).toFixed(2) + ' 100');
  document.getElementById('minimal-measured').setAttribute('stroke-dasharray', (heat * (1 - estimatedPart) * 100).toFixed(2) + ' 100');
  document.getElementById('minimal-estimated').setAttribute('stroke-dasharray', (heat * estimatedPart * 100).toFixed(2) + ' 100');
  document.getElementById('minimal-estimated').setAttribute('stroke-dashoffset', String(-heat * (1 - estimatedPart) * 100));
  if (measuredPeak !== null && snapshot && snapshot.status === 'ready' && !view.workerError && snapshot.updatedAt > lastPeakSnapshotAt) {
    const newPeak = hasLiveSample && measuredPeak > sessionPeak + .1;
    sessionPeak = measuredPeak;
    lastPeakSnapshotAt = snapshot.updatedAt;
    hasLiveSample = true;
    if (newPeak && !document.hidden && !reducedMotion.matches && preferences.effects !== 'off') {
      const hero = document.getElementById('hero');
      hero.classList.add('peak');
      clearTimeout(peakTimer);
      peakTimer = setTimeout(() => { hero.classList.remove('peak'); peakTimer = null; }, preferences.effects === 'high' ? 1800 : 750);
    }
  }
  syncEffects();
}
document.addEventListener('visibilitychange', syncEffects);
reducedMotion.addEventListener('change', syncEffects);
window.addEventListener('pagehide', () => { clearTimeout(peakTimer); peakTimer = null; });
`;
