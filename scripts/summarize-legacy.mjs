import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const matrix=await read('output/playwright/legacy-comparison.json');
const defaults=await read('output/playwright/legacy-default-comparison.json');
const panel=defaults.results.find(r=>r.profile==='original-no-controls')|| (await read('output/playwright/legacy-panel-check.json')).results[0];
const commit=matrix.current.commit||'6862096db9f6208405cff7840d7dfe772a10d7c2';
if(createHash('sha256').update(await readFile('src/snow.js')).digest('hex')!==matrix.current.sha256)throw new Error('Current code changed after the benchmark');
const avg=values=>values.reduce((a,b)=>a+b,0)/values.length;
const pooled=rows=>rows.reduce((n,r)=>n+r.callbackWorkMs.sum,0)/rows.reduce((n,r)=>n+r.callbackWorkMs.n,0);
const oldDefaults=defaults.results.filter(r=>r.profile==='default-renderer');
const newDefault=defaults.results.find(r=>r.version==='current');
const oldOriginal=defaults.results.find(r=>r.version==='legacy'&&r.profile==='original');
const oldMatched=matrix.results.filter(r=>r.version==='legacy'&&r.repeat&&r.count===200);
const newMatched=matrix.results.filter(r=>r.version==='current'&&r.repeat&&r.count===200);
const oldMean=pooled(oldDefaults),newMean=newDefault.callbackWorkMs.mean;
const oldP95=avg(oldDefaults.map(r=>r.callbackWorkMs.p95)),newP95=newDefault.callbackWorkMs.p95;
const oldEqual=pooled(oldMatched),newEqual=pooled(newMatched);
const oldBytes=oldDefaults[0].buffers.reduce((n,b)=>n+b.pixels*4,0),newBytes=newDefault.buffers.reduce((n,b)=>n+b.pixels*4,0);
const summary={defaultMeanCpuRatio:oldMean/newMean,defaultP95CpuRatio:oldP95/newP95,matchedMeanCpuReductionPercent:(1-newEqual/oldEqual)*100,matchedLegacyMeanMs:oldEqual,matchedCurrentMeanMs:newEqual,nominalRgbaBytes:{legacy:oldBytes,current:newBytes},currentCommit:commit};
await writeFile('docs/legacy-comparison-data.json',JSON.stringify({summary,matrix,defaults,panel},null,2)+'\n');
const report=`# Сравнение bb_snowflakes 2025 и bb-snowflakes 2026

Дата: 22 октября 2026 года.

Текущий вариант существенно легче на своих стандартных настройках. Основная причина: 40 частиц и один слой вместо 3200 частиц и трёх слоёв. При одинаковых 200 частицах без размытия расходы CPU практически совпали. Ускорение самого алгоритма не подтверждено.

## Зафиксированные версии

- Старый [4nri/bb_snowflakes](https://github.com/4nri/bb_snowflakes), master [c492fa2](https://github.com/4nri/bb_snowflakes/tree/c492fa2f979a01b5aea95fe28f821f46827b445e), 25 ноября 2025 года. Весь проект состоит из одного index.html. Его SHA-256: \`${matrix.legacy.sha256}\`.
- Новый [4nri/bb-snowflakes](https://github.com/4nri/bb-snowflakes), модуль src/snow.js из [${commit.slice(0,7)}](https://github.com/4nri/bb-snowflakes/blob/${commit}/src/snow.js). SHA-256: \`${matrix.current.sha256}\`.

## Результат на стандартных настройках

CPU ×10, один мобильный экран 393 × 852, DPR 3, одинаковый статичный фон. Панель старого демо скрыта. В старой анимации сохранены её исходные 3200 частиц, размеры, скорости и blur(2px) переднего слоя. Новая анимация использует стандартные 40 точек. Это сравнение разных по плотности и детализации эффектов.

| Показатель | Старый эффект | Текущий эффект |
| --- | --- | --- |
| Частиц на экран | 3200 | 40 |
| Canvas | 3 | 1 |
| Среднее CPU-время кадра | ${oldMean.toFixed(2)} мс | ${newMean.toFixed(2)} мс |
| CPU-время p95 | ${oldP95.toFixed(1)} мс | ${newP95.toFixed(1)} мс |
| Средняя частота отрисовки | ${avg(oldDefaults.map(r=>r.effect.fps)).toFixed(1)} FPS | ${newDefault.effect.fps.toFixed(1)} FPS |
| Номинальный объём RGBA-буферов | ${(oldBytes/1e6).toFixed(2)} МБ | ${(newBytes/1e6).toFixed(2)} МБ |

В этих длинных прогонах среднее время расчёта и отправки команд Canvas уменьшилось примерно в ${(oldMean/newMean).toFixed(1)} раза, p95 примерно в ${(oldP95/newP95).toFixed(1)} раза. Это дополнительный запас в бюджете кадра. Оба эффекта без панели в среднем работали около 60 FPS, поэтому это не рост FPS в указанное число раз.

Частиц стало в 80 раз меньше. Такая разница настроек не доказывает превосходства алгоритма. Объём буферов рассчитан как width × height × 4 байта, без накладных расходов браузера, промежуточных поверхностей размытия и иных GPU-ресурсов. Оба проекта используют Canvas DPR 1.

## Одинаковые 200 точек

Три парных прогона по 8 секунд при CPU ×10, с чередованием порядка вариантов. Старый эффект сохраняет три Canvas, Float32Array и исходные функции update/draw/reset. В тестовом адаптере отключено размытие, скрыта панель, выровнены фон, общее количество, диапазон радиусов, непрозрачность и средняя скорость падения.

| Показатель | Старый без размытия | Текущий |
| --- | --- | --- |
| Общее число точек | 200 | 200 |
| Среднее CPU-время кадра, объединённая выборка | ${oldEqual.toFixed(3)} мс | ${newEqual.toFixed(3)} мс |
| p95 по отдельным прогонам | ${Math.min(...oldMatched.map(r=>r.callbackWorkMs.p95)).toFixed(1)}–${Math.max(...oldMatched.map(r=>r.callbackWorkMs.p95)).toFixed(1)} мс | ${Math.min(...newMatched.map(r=>r.callbackWorkMs.p95)).toFixed(1)}–${Math.max(...newMatched.map(r=>r.callbackWorkMs.p95)).toFixed(1)} мс |
| Минимум кадров в скользящем окне 1 с | 60 | 60 |

Разница средних составила ${((1-newEqual/oldEqual)*100).toFixed(1)}%. Знак разницы между вариантами менялся в отдельных парных прогонах; такой результат находится на фоне разброса измерений. Оснований объявлять новый вычислительный цикл быстрее нет.

Это близкие по параметрам, но не попиксельно одинаковые сцены: формулы покачивания, распределение скоростей и поведение при повторном появлении частиц отличаются. В старом адаптере частицы распределены 125/63/12 по слоям, радиусы 1.48–2, opacity 0.65, speed 0.06, windSpeed 0.875 и fallSpeed 5. Примерная средняя скорость падения совпадает с новой: 18.9 px/с. Код движка старой версии не переписывался.

## Что влияло на старое демо

У исходной панели есть backdrop-filter: blur(10px), а у переднего Canvas filter: blur(2px). Панель закрывает большую часть мобильного viewport. При неизменных фоне, количестве и настройках скрытие только панели изменило результат этого 20-секундного прогона при CPU ×10:

| Вариант | FPS среднее | Минимум за 1 с | Паузы >25 мс |
| --- | --- | --- | --- |
| Исходный проект с панелью | ${oldOriginal.effect.fps.toFixed(1)} | ${oldOriginal.effect.minRolling1sFps} | ${oldOriginal.effect.gapsOver25ms} |
| Тот же проект, панель скрыта | ${panel.effect.fps.toFixed(1)} | ${panel.effect.minRolling1sFps} | ${panel.effect.gapsOver25ms} |

В этом прогоне скрытие панели сократило число пропусков. Время CPU-цикла самой анимации почти не изменилось. Одного парного прогона недостаточно для точной оценки стоимости панели. Стоимость размытия на слабом GPU отдельно не измерялась.

## Что уже было хорошо сделано в старом коде

- [Float32Array и заранее рассчитанные скорости](https://github.com/4nri/bb_snowflakes/blob/c492fa2f979a01b5aea95fe28f821f46827b445e/index.html#L251). Данные частиц хранятся компактно.
- [Один проход обновления и рисования](https://github.com/4nri/bb_snowflakes/blob/c492fa2f979a01b5aea95fe28f821f46827b445e/index.html#L300), общий путь и одна заливка на слой.
- Один requestAnimationFrame на три слоя. Три Canvas не означают три независимых планировщика.
- DPR не увеличивается на Retina. По этому пункту у новой версии нет преимущества.

## В чём новый вариант полезнее для передачи в разработку

- Один Canvas, одна заливка, нет размытия. Меньше поверхностей и операций композиции.
- [Учитывается время между кадрами](https://github.com/4nri/bb-snowflakes/blob/${commit}/src/snow.js#L103). В старом коде позиции меняются на фиксированный шаг за кадр: при падении FPS снег замедляется, при высокой частоте ускоряется.
- [Остановка для нулевого количества, выключения, паузы, скрытого документа, невидимого контейнера и reduced-motion](https://github.com/4nri/bb-snowflakes/blob/${commit}/src/snow.js#L65).
- Отдельный класс с update/pause/play/destroy, ResizeObserver и чисткой обработчиков. Старый проект представляет собой страницу с глобальным состоянием и тремя фиксированными слоями.
- Настройки ветра и скорости применяются на следующем кадре. В старом коде скорости записываются в массив при создании или повторном появлении снежинки, поэтому изменение общего параметра затрагивает существующие частицы постепенно.

В контрольном тесте с нулём частиц старая версия продолжала вызывать цикл и очищать три Canvas около 60 раз в секунду. Новый модуль прекратил кадры полностью. Сам браузер может приостанавливать requestAnimationFrame в фоновой вкладке у обеих версий; дополнительный выигрыш нового варианта в фоне здесь не заявляется.

## Размер кода

| Исходный код без минификации | Байты | gzip, байты |
| --- | --- | --- |
| Старый index.html целиком, с CSS и панелью | ${matrix.legacy.htmlBytes} | ${matrix.legacy.htmlGzip} |
| Старый inline-JS с обработчиками панели | ${matrix.legacy.scriptBytes} | ${matrix.legacy.scriptGzip} |
| Новый самостоятельный src/snow.js | ${matrix.current.scriptBytes} | ${matrix.current.scriptGzip} |

Новый самостоятельный модуль в gzip примерно на ${((matrix.current.scriptGzip/matrix.legacy.scriptGzip-1)*100).toFixed(0)}% больше старого inline-JS. Это разные наборы функций: в старом JS присутствуют обработчики панели, в новом классе больше API и правил жизненного цикла. Уменьшение размера JS не подтверждено. Полный новый стенд дополнительно загружает два PNG-макета; его загрузку нельзя сравнивать с прежней страницей без изображений как нагрузку самой анимации.

## Практический вывод

Для лёгкого снега на готовом макете текущая конфигурация подходит лучше: меньше частиц и слоёв, больше запаса на кадр, явное управление временем работы эффекта. У старого рендера уже были удачные решения. Если потребуется снижать CPU-время при большом числе частиц, стоит отдельно проверить перенос Float32Array и объединение обновления с отрисовкой в один проход. Из этого сравнения нельзя вывести гарантированный выигрыш такой доработки.

## Условия и повторение

Chrome ${matrix.browser}, headless, ${matrix.host.cpu}, ${matrix.host.arch}. Мобильный viewport 393 × 852, deviceScaleFactor 3. Фактические буферы всех Canvas имеют 393 × 852. CPU замедляется через CDP. Фиксированный seed Math.random, 2 секунды прогрева, 26 сценариев по 8 секунд и 5 контрольных сценариев по 20 секунд.

CPU-время в отчёте означает время расчёта и отправки команд Canvas внутри callback, не полную загрузку процесса, энергопотребление или GPU-время. Частота измеряется по фактическим вызовам Canvas, а не по физическому показу пикселей дисплеем. Замер включает накладные расходы обёртки для регистрации кадров и вызовов Canvas. Маленькие времена ограничены точностью таймера, поэтому особенно важны повторения и абсолютные значения. CPU throttling не воспроизводит слабый GPU и нагрев реального телефона.

Исходное демо в коротких прогонах показало немонотонную частоту при разных коэффициентах CPU. Для вывода о стандартной нагрузке использованы более длинные прогоны ×10 с одинаковым фоном и отдельно проверенной панелью. Все значения, включая неудобные результаты, сохранены в [исходных данных](legacy-comparison-data.json).

Для повторения нужны Node.js, Google Chrome, Playwright как инструмент тестирования и GitHub CLI для получения старого файла по закреплённому commit. Сценарий проверяет SHA-256 старого index.html.

\`\`\`sh
npm install --no-save --package-lock=false playwright
npm run dev
# В другом терминале:
npm run compare:legacy
COMPARE_OPTIONS_FILE=docs/legacy-comparison-options.json COMPARE_OUTPUT=output/playwright/legacy-default-comparison.json npm run compare:legacy
node scripts/summarize-legacy.mjs
\`\`\`

Движки обеих версий при сравнении оставлены без изменений. Тестовый адаптер меняет параметры и стили только внутри отдельного браузерного профиля.
`;
await writeFile('docs/legacy-comparison.md',report);
console.log(summary);
