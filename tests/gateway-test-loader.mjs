// Node's native TS stripper does not resolve bundler-style extensionless imports.
import {readFileSync} from 'node:fs';
import ts from 'typescript';
export function gatewayModuleUrl(name){
 const source=readFileSync(new URL(`../src/lib/${name}.ts`,import.meta.url),'utf8')
  .replaceAll("'./gateway'",JSON.stringify(new URL('../src/lib/gateway.ts',import.meta.url).href))
  .replaceAll("'viem'",JSON.stringify(new URL('../node_modules/viem/_esm/index.js',import.meta.url).href));
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
