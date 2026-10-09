import { readServiceResponse } from '../server/service-response.mjs';
import type { Photo } from './types';
export type UploadSession={id:string;receipt:string;expiresAt?:number;uploaded?:boolean;signature?:string;filename?:string};
export function newSubmissionSession():UploadSession {
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  return {id:crypto.randomUUID(),receipt:[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('')};
}
export function photoAnnotation(p:Photo) {
  const {title,description,capturedAt,locationId,buildingId,floor,captureType,altitude,cameraHeight,position,heading,pitch,placed,author,copyright,view}=p;
  return {title,description,capturedAt,locationId,buildingId,floor,captureType,altitude,cameraHeight,position:{x:position.x,z:position.z},heading,pitch,placed,author,copyright,view};
}
export function createSubmissionsClient(baseURL:string,transport:typeof fetch=fetch) {
  const base=baseURL.replace(/\/+$/,'');
  async function request(route:string,value?:unknown) {
    let response;
    try {response=await transport(base+'/api/submissions/'+route,{method:value?'POST':'GET',headers:{'Content-Type':'application/json'},body:value?JSON.stringify(value):undefined,credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});}
    catch {throw new Error('无法连接投稿服务，可能是网络中断或服务限额拦截。当前照片和标注仍在页面中，请稍后重试。');}
    return readServiceResponse(response);
  }
  return {config:()=>request('config'),start:(session:UploadSession,file:File,p:Photo,turnstileToken:string)=>request('start',{id:session.id,receipt:session.receipt,filename:file.name,size:file.size,contentType:file.type,annotation:photoAnnotation(p),turnstileToken}),
    complete:(session:UploadSession)=>request('complete',{id:session.id,receipt:session.receipt}),status:(session:UploadSession)=>request('status',{id:session.id,receipt:session.receipt})};
}
export function uploadOriginal(url:string,file:File,onProgress:(progress:number)=>void):Promise<void> {
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('PUT',url);xhr.setRequestHeader('Content-Type',file.type);xhr.timeout=180000;
    xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(e.loaded/e.total);};
    xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300)resolve();else {void readServiceResponse(new Response(xhr.responseText || '{}',{status:xhr.status})).catch(reject);}};
    xhr.onerror=()=>reject(new Error('原片上传未完成，请检查网络后重试。照片和标注已保留。'));
    xhr.ontimeout=()=>reject(new Error('原片上传超时，请重试。照片和标注已保留。'));
    xhr.onabort=()=>reject(new Error('上传已中断，照片和标注已保留。'));xhr.send(file);
  });
}
