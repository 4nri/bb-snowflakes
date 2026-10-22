import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const read=async name=>JSON.parse(await readFile('output/playwright/'+name,'utf8'));
const baseline=await read('cpu-blur-baseline.json'),matrix=await read('cpu-blur.json'),long=await read('cpu-blur-long.json');
const sources={};
for(const name of ['src/snow.js','src/app.js','index.html','styles.css']){
 const bytes=await readFile(name);sources[name]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,gzipBytes:gzipSync(bytes).length};
}
const beforeSource=await readFile('output/blur-baseline/src/snow.js');
const beforeSHA256=createHash('sha256').update(beforeSource).digest('hex');
const results=[...matrix.results,...long.results];
const failures=results.filter(r=>r.clock.gapsOver25ms||r.skippedCallbacks.length||Object.values(r.canvases).some(c=>c.gapsOver25ms));
await writeFile('docs/performance-blur-data.json',JSON.stringify({baselineCommit:'4aa612f',beforeSHA256,sources,baseline,finalMatrix:matrix,finalLong:long,prototypeData:'performance-blur-prototype-data.json'},null,2)+'\n');
const f=n=>n.toFixed(2).replace('.',',');
const names={'module-mobile':'Модуль 393 × 852','demo-desktop':'Два макета','demo-mobile':'Мобильный стенд'};
const row=r=>{
 const values=r.enabled?Object.values(r.canvases):[r.clock];
 return `| ${names[r.mode]}${r.interaction?', жесты '+r.control:''}${!r.enabled?', выключен':''} | ×${r.rate} | ${r.count*(r.mode==='module-mobile'?1:2)} | ${Math.round(r.blur*100)}% | ${r.sizeVariation} | ${f(Math.min(...values.map(c=>c.fps)))} | ${Math.min(...values.map(c=>c.minRolling1sFps))} | ${f(Math.max(...values.map(c=>c.maxMs)))} | ${Math.max(...values.map(c=>c.gapsOver25ms))} | ${f(r.callbackWorkP95Ms)} |`;
};
const header='| Сценарий | CPU | Частиц | Blur | Разброс | FPS | Минимум за 1 с | Макс. интервал, мс | Пауз >25 мс | CPU p95, мс |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
const comparison=baseline.results.map(b=>{
 const current=matrix.results.find(r=>r.mode===b.mode&&r.rate===b.rate&&r.count===b.count&&r.size===b.size&&r.sizeVariation===b.sizeVariation&&r.blur===1&&!r.interaction);
 const zero=matrix.results.find(r=>r.mode===b.mode&&r.rate===b.rate&&r.count===b.count&&r.size===b.size&&r.sizeVariation===b.sizeVariation&&r.blur===0&&!r.interaction);
 return `| ${names[b.mode]}, ${b.count*(b.mode==='module-mobile'?1:2)} частиц | ${f(b.callbackWorkP95Ms)} | ${zero?f(zero.callbackWorkP95Ms):'нет прогона'} | ${current?f(current.callbackWorkP95Ms):'нет прогона'} |`;
});
const prototype=JSON.parse(await readFile('docs/performance-blur-prototype-data.json','utf8'));
const protoGaps=prototype.results.filter(r=>r.clock.gapsOver25ms);
const report=`# Размытие снега: проверка производительности

22 октября 2026 года. В финальной версии ${results.length-failures.length} из ${results.length} сценариев прошли без интервалов >25 мс в независимом кадровом цикле и отрисовке эффекта, без пропущенных callback. Полные результаты, включая отклонения, сохранены ниже. Эмуляция CPU не заменяет проверку физического телефона.

## Что изменилось

- Сила размытия задаётся параметром blur 0–1, стандартное значение 0.4. При 0 используется прежняя общая заливка чётких точек.
- Средний план остаётся резким; дальние точки мягче, ближние сильнее. Случайная глубина и позиции сохраняются при настройке.
- Восемь радиальных масок мягкого круга генерируются один раз в общем атласе 64 × 512 px. Мягкий край формируется заранее по радиальному профилю; в каждом кадре используются готовые маски. Минимальная ненулевая мягкость округляется к первому уровню, чтобы при стандартном разбросе дальний план тоже имел мягкий край.
- Кэш составляет 128 КиБ RGBA без служебных расходов браузера/GPU. На каждый макет остаётся один видимый Canvas с DPR 1. Новых сетевых ресурсов нет. Радиусы и номера масок пересчитываются при настройке, а не на каждом кадре.
- Модуль: ${sources['src/snow.js'].bytes} байт исходника, ${sources['src/snow.js'].gzipBytes} байт gzip. Ранее ${beforeSource.length} / ${gzipSync(beforeSource).length} байт. Копирование мягких частиц и прозрачность добавляют работу; размытие не считается бесплатным.

## Условия

Chrome ${matrix.browser}, headless; ${matrix.host.cpu}, ${matrix.host.arch}. CPU ×6/×10 через CDP Emulation.setCPUThrottlingRate. Контрольная целочисленная работа подтверждает замедление: ${matrix.calibration.map(c=>'×'+c.rate+': '+f(c.medianMs)+' мс').join('; ')}.

Сравнение до изменения: commit 4aa612f; SHA-256 snow.js ${beforeSHA256}. Финальный SHA-256: ${sources['src/snow.js'].sha256}.

Короткие сценарии: ${matrix.results.length} × ${matrix.durationMs/1000} с, длительные: ${long.results.length} × ${long.durationMs/1000} с; перед каждым 2 с прогрева. В модуле Canvas занимает 393 × 852 при viewport DPR 3. Стенд 1280 × 900 содержит два макета; отдельно проверен мобильный вид 393 × 852. Все Canvas используют DPR 1. Проверены максимальный радиус 6 px, размытие 0/40/100%, разброс 0/1, 80/400 частиц. При разбросе 0 все точки близкие и максимально мягкие, что проверяет вариант без резких точек.

Жесты: input 10 раз в секунду, по 1 с движения и 0.5 с паузы, change после отпускания. Сценарий blur начинается с 0, поэтому включает первое создание кэша во время измерения. Время input/change сохранено в данных.

Независимый requestAnimationFrame фиксирует интервалы браузера; clearRect видимых Canvas фиксирует реальные команды отрисовки. Считаются средний FPS, минимум в окне 1 с с шагом 100 мс, p95/p99/максимум интервала, паузы >25/>50 мс, пропущенные callback, long tasks. CPU p95 включает расчёт и отправку Canvas-команд всех активных экранов за callback, вместе с обёрткой измерений. GPU-время, физическая презентация пикселей, температура и энергопотребление не измеряются. Минимум 59 в окне сам по себе не означает потерю кадра: при 59.94 Hz часть секунд содержит 59 событий; оценка опирается также на интервалы.

## Прежняя версия без размытия

${header}
${baseline.results.map(row).join('\n')}

## Финальная матрица

${header}
${matrix.results.map(row).join('\n')}

## Длинные повторы и контроль

${header}
${long.results.map(row).join('\n')}

## Цена размытия при CPU ×10

| Нагрузка | Прежний модуль p95, мс | Новый blur 0 p95, мс | Новый blur 1 p95, мс |
| --- | --- | --- | --- |
${comparison.join('\n')}

Таблица описывает наблюдаемые прогоны, не точное ускорение алгоритма. Случайное распределение частиц и фоновые процессы могут влиять на короткие замеры. Длинные повторы проверяют кадровые интервалы при максимальной мягкости.

## Отклонение в первом прототипе

${protoGaps.length?protoGaps.map(r=>`На CPU ×${r.rate}, ${r.count*2} частицах и blur ${r.blur} была пауза ${f(r.clock.maxMs)} мс. В том же прогоне максимальная работа callback ${f(r.callbackWorkMaxMs)} мс, long tasks ${r.longTasks.length}, пропущенных callback ${r.skippedCallbacks.length}. Причина паузы не установлена.`).join('\n'):'Отклонений нет.'} Прототип затем изменён: минимальная мягкость дальнего плана больше не округляется к нулю. Полная матрица повторена на окончательном коде. Нельзя приписывать устранение паузы этому изменению. Исходные данные прототипа не удалены: [performance-blur-prototype-data.json](performance-blur-prototype-data.json).

## Воспроизведение и предел вывода

Финальная матрица: PERF_OPTIONS_FILE=docs/performance-blur-options.json PERF_OUTPUT=output/playwright/cpu-blur.json npm run perf. Длинные повторы: PERF_OPTIONS_FILE=docs/performance-blur-long-options.json PERF_OUTPUT=output/playwright/cpu-blur-long.json npm run perf. Сравнение до изменения использует копию commit 4aa612f в output/blur-baseline и docs/performance-blur-baseline-options.json. Общий отчёт собирает node scripts/summarize-blur.mjs.

При этой CPU-эмуляции ${failures.length?'были отклонения; строгие 60 FPS во всех сценариях не подтверждены':'подтверждено сохранение ровного кадрового интервала около 60 FPS на всех проверенных нагрузках финальной версии'}. Это не гарантия для всех слабых телефонов: CPU throttling не воспроизводит их GPU, нагрев и энергосбережение. Полные данные: [performance-blur-data.json](performance-blur-data.json). Параметры всех сценариев проверяются перед началом измерений.
`;
await writeFile('docs/performance-blur.md',report);
console.log(JSON.stringify({scenarios:results.length,failed:failures.length,failures:failures.map(r=>({mode:r.mode,rate:r.rate,count:r.count,blur:r.blur,max:r.clock.maxMs,gaps:r.clock.gapsOver25ms})),sources},null,2));
