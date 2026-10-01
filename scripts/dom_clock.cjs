// Deterministic animation clock for DOM checks; no browser layout is simulated.
exports.installDomClock=function(w,{autoFlush=false}={}){
 let now=0,next=0;const queue=new Map();
 Object.defineProperty(w.performance,'now',{value:()=>now});
 w.requestAnimationFrame=callback=>{queue.set(++next,callback);return next;};
 w.cancelAnimationFrame=id=>queue.delete(id);
 function step(ms=16){now+=ms;const callbacks=[...queue.values()];queue.clear();callbacks.forEach(callback=>callback(now));}
 function flush(){let frames=0;while(queue.size&&frames++<160)step();if(queue.size)throw new Error('Map animation did not settle within 160 frames');}
 if(autoFlush){
  const click=w.HTMLElement.prototype.click,dispatch=w.EventTarget.prototype.dispatchEvent;
  w.HTMLElement.prototype.click=function(...args){const result=click.apply(this,args);flush();return result;};
  w.EventTarget.prototype.dispatchEvent=function(...args){const result=dispatch.apply(this,args);flush();return result;};
 }
 const clock={step,flush,pending:()=>queue.size};w.__mapTestClock=clock;return clock;
};
