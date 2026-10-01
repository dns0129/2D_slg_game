/* Local bitmap planes for camera motion. Full SVG geometry remains authoritative. */
(() => {
  'use strict';
  class MotionCache {
    constructor(map,physical){
      this.map=map;this.physical=physical;this.paths=new Map();this.planes=[];this.key=null;this.bounds=null;
      this.canvas=document.createElement('canvas');this.canvas.id='motion-map';this.canvas.setAttribute('aria-hidden','true');
      this.context=typeof Path2D==='function'?this.canvas.getContext('2d',{alpha:false,desynchronized:true}):null;
      if(!this.context)return;
      map.before(this.canvas);this.images=(physical.relief||[]).map(meta=>{const image=new Image();image.src=meta.url;return {meta,image};});
    }
    invalidate(){this.key=null;this.bounds=null;this.hide();}
    hide(){this.canvas.style.display='none';this.map.classList.remove('motion-preview');}
    contains(v){const b=this.bounds;return b&&v.x>=b[0]&&v.y>=b[1]&&v.x+v.w<=b[0]+b[2]&&v.y+v.h<=b[1]+b[3];}
    prepare(view,target,size,key,units,regions,countries){
      if(!this.context)return false;
      // Refresh a coarse country snapshot as we approach a province. Otherwise
      // cached outlines would become wide, blurry bands after a large zoom.
      if(this.key===key&&this.contains(view)&&this.contains(target)&&(target.w>=view.w||view.w/this.bounds[2]>.35))return true;
      const x=Math.min(view.x,target.x),y=Math.min(view.y,target.y),w=Math.max(view.x+view.w,target.x+target.w)-x,h=Math.max(view.y+view.h,target.y+target.h)-y;
      this.bounds=[x-w*.2,y-h*.2,w*1.4,h*1.4];this.key=key;
      const b=this.bounds,ratio=b[2]/b[3],width=Math.min(2048,Math.round(size.width*1.4)),height=Math.min(2048,Math.round(width/ratio));
      const bounds=new Map([...units.map(p=>[p.id,p.bounds]),...regions.map(r=>[r.id,r.bounds]),...countries.map(c=>[c.id,c.bounds])]);
      const groups=[['base',null],['context','#context-layer'],['national','#national-layer'],['administration','#territory-layer, #macro-layer'],['district','#district-border-layer'],['water',null],['regionWater','[data-water-detail="region"]'],['districtWater','[data-water-detail="district"]']];
      this.planes=groups.map(([name,selector],index)=>{
        const canvas=this.planes[index]?.canvas||document.createElement('canvas');canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext('2d'),scale=width/b[2];ctx.setTransform(scale,0,0,height/b[3],-b[0]*scale,-b[1]*height/b[3]);
        let paths;
        if(name==='base'){
          ctx.fillStyle='#eef5f7';ctx.fillRect(b[0],b[1],b[2],b[3]);paths=[...this.map.children].filter(el=>el.tagName.toLowerCase()==='path');
        }else if(name==='water')paths=[...this.map.querySelector('#water-layer').children].filter(el=>el.tagName.toLowerCase()==='path');
        else paths=[...this.map.querySelectorAll(selector)].flatMap(el=>[...el.querySelectorAll('path')]);
        for(const el of paths){
          const extent=bounds.get(el.dataset.unit||el.dataset.unitBorder||el.dataset.region||el.dataset.country);
          if(extent&&(extent[0]>b[0]+b[2]||extent[1]>b[1]+b[3]||extent[0]+extent[2]<b[0]||extent[1]+extent[3]<b[1]))continue;
          const d=el.getAttribute('d');let path=this.paths.get(d);if(!path){path=new Path2D(d);this.paths.set(d,path);}
          const fill=el.getAttribute('fill'),stroke=el.getAttribute('stroke'),opacity=Number(el.getAttribute('opacity')||1);
          if(fill&&fill!=='none'&&fill!=='transparent'){ctx.globalAlpha=opacity*Number(el.getAttribute('fill-opacity')||1);ctx.fillStyle=fill;ctx.fill(path,el.getAttribute('fill-rule')||'nonzero');}
          if(stroke&&stroke!=='none'){ctx.globalAlpha=opacity;ctx.strokeStyle=stroke;ctx.lineWidth=Number(el.getAttribute('stroke-width')||1)*view.w/size.width;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke(path);}
        }
        return {name,canvas};
      });
      return true;
    }
    draw(view,levels,z,size,scenario){
      if(!this.context||!this.bounds)return false;
      const ratio=Math.min(window.devicePixelRatio||1,1.5),width=Math.round(size.width*ratio),height=Math.round(size.height*ratio);
      if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;
      const ctx=this.context,b=this.bounds,sx=width/view.w,sy=height/view.h,rect=[(b[0]-view.x)*sx,(b[1]-view.y)*sy,b[2]*sx,b[3]*sy];
      ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.fillStyle='#eef5f7';ctx.fillRect(0,0,width,height);
      const alpha={base:1,context:1,national:levels.national,administration:levels.administration,district:levels.district,water:1,regionWater:levels.administration,districtWater:levels.district};
      const paint=plane=>{ctx.globalAlpha=alpha[plane.name];if(ctx.globalAlpha>.002)ctx.drawImage(plane.canvas,...rect);};
      paint(this.planes[0]);
      for(const {image,meta} of this.images){
        if(!image.complete||!image.naturalWidth)continue;
        const threshold=meta.demZoom===5||scenario==='three'&&meta.demZoom===8?0:meta.minZoom;
        const t=threshold?Math.max(0,Math.min(1,(z-threshold*.85)/(threshold*.35))):1;ctx.globalAlpha=t*t*(3-2*t);
        if(ctx.globalAlpha>.002){const r=meta.bounds;ctx.drawImage(image,(r[0]-view.x)*sx,(r[1]-view.y)*sy,r[2]*sx,r[3]*sy);}
      }
      for(const plane of this.planes.slice(1))paint(plane);
      // Planned movement is cheap to draw and does not need a separate bitmap.
      const route=this.map.querySelector('#route-layer path');
      if(route&&levels.district>.002){ctx.setTransform(sx,0,0,sy,-view.x*sx,-view.y*sy);ctx.globalAlpha=levels.district;ctx.strokeStyle='#326b60';ctx.lineWidth=2/sx;ctx.stroke(new Path2D(route.getAttribute('d')));}
      this.canvas.style.display='block';this.map.classList.add('motion-preview');return true;
    }
  }
  window.SHANHE_MOTION_CACHE=MotionCache;
})();
