import ExcelJS from "exceljs";
import { join } from "node:path";
const f = process.argv[2], r0 = +process.argv[3], r1 = +process.argv[4];
const cols = (process.argv[5]||"2,3,4,7,9,10,13,14,17,19,20,24").split(",").map(Number);
function L(n:number){let s="";while(n>0){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26);}return s;}
function S(v:any):string{if(v==null)return"";if(typeof v==="object"){if("result"in v)return S((v as any).result);if("richText"in v)return (v as any).richText.map((t:any)=>t.text).join("");return JSON.stringify(v).slice(0,18);}return String(v).slice(0,18);}
(async()=>{const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(join("qa/golden-oracle/.cache",f));const ws=wb.worksheets.find(w=>/expenditure breakdown/i.test(w.name))!;
for(let r=r0;r<=r1;r++){const row=ws.getRow(r);const parts:string[]=[];for(const c of cols){const v=row.getCell(c).value;const s=S(v);if(s.trim())parts.push(`${L(c)}=${s}`);}if(parts.length)console.log(`r${r}: ${parts.join(" | ")}`);}
})();
