import { useEffect, useRef, useState } from 'react';
type TurnstileAPI={render:(element:HTMLElement,options:Record<string,unknown>)=>string;remove:(id:string)=>void;reset:(id:string)=>void};
declare global {interface Window {turnstile?:TurnstileAPI}}
let loader:Promise<void>|undefined;
function loadWidget() {
  return loader ||= new Promise<void>((resolve,reject)=>{
    if(window.turnstile){resolve();return;}
    const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
    script.onload=()=>resolve();script.onerror=()=>{loader=undefined;script.remove();reject(new Error('验证组件加载失败，请检查网络后重试。'));};document.head.append(script);
  });
}
export default function Turnstile({siteKey,onToken,reset}: {siteKey:string;onToken:(token:string)=>void;reset:number}) {
  const container=useRef<HTMLDivElement>(null),callback=useRef(onToken);callback.current=onToken;
  const [error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let cancelled=false,id:string|undefined;
    callback.current('');setError('');
    void loadWidget().then(()=>{if(cancelled || !container.current || !window.turnstile)return;
      id=window.turnstile.render(container.current,{sitekey:siteKey,action:'photo-submit',theme:'auto',size:'flexible',callback:(token:string)=>callback.current(token),
        'expired-callback':()=>callback.current(''),'error-callback':()=>{callback.current('');setError('验证暂时不可用，请重试。');return true;}});
    }).catch(e=>{if(!cancelled)setError(e.message);});
    return()=>{cancelled=true;if(id)window.turnstile?.remove(id);};
  },[siteKey,reset,retry]);
  return <div className="submission-verification"><div ref={container}/>{error && <p role="alert">{error}<button className="text-button" onClick={()=>setRetry(n=>n+1)} type="button">重新验证</button></p>}</div>;
}
