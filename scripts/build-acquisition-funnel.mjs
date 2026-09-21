import fs from 'node:fs';
const core=fs.readFileSync(new URL('../packages/acquisition-funnel/core.js',import.meta.url),'utf8').replace('export function','function');
const target=new URL('../apps/forms-studio/public/_worker.js',import.meta.url);
let worker=fs.readFileSync(target,'utf8').split('// BEGIN GENERATED ACQUISITION FUNNEL')[0];
worker=worker.replace('export default {','const formsWorker = {');
worker=worker.replace(".filter((value) => value.split('=', 1)[0] !== ACCESSIBLE_JAPAN_SESSION_COOKIE)",".filter((value) => ![ACCESSIBLE_JAPAN_SESSION_COOKIE, 'af_visit'].includes(value.split('=', 1)[0]))");
worker+='// BEGIN GENERATED ACQUISITION FUNNEL\n'+core+`\nconst acquisitionFunnel=createAcquisitionFunnel({
 origin:'https://liffform-studio.pages.dev',surface:'form',
 document:url=>url.pathname==='/public-form'&&url.searchParams.get('id')===ACCESSIBLE_JAPAN_FORM_ID&&!url.searchParams.has('issue'),
 submitPath:'/api/forms/'+ACCESSIBLE_JAPAN_FORM_ID+'/submit',saved:body=>body?.success===true,
 linkPath:'/go/aj-form',destination:'/public-form?id='+ACCESSIBLE_JAPAN_FORM_ID,
 authorize:hasReportAccess,
});
export default {fetch(request,env,context){return acquisitionFunnel.run(request,env,context,r=>formsWorker.fetch(r,env,context));}};
`;
fs.writeFileSync(target,worker);
