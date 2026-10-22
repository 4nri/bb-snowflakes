import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {cpus,platform,arch} from 'node:os';
import runScenarios from './perf-scenarios.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'no-preference'});
  const page=await context.newPage();
  const options=process.env.PERF_OPTIONS_FILE?JSON.parse(await readFile(process.env.PERF_OPTIONS_FILE,'utf8')):process.env.PERF_OPTIONS?JSON.parse(process.env.PERF_OPTIONS):{};
  const output=resolve(process.env.PERF_OUTPUT||'output/playwright/cpu-baseline.json');
  await mkdir(dirname(output),{recursive:true});
  options.onResult=result=>writeFile(output,JSON.stringify({...result,host:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model}},null,2)+'\n');
  const result=await runScenarios(page,options);
  await options.onResult(result);console.log('RESULT '+output);
}finally{await browser.close();}
