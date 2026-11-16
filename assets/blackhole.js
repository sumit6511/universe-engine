import{B as e,D as t,E as n,F as r,L as i,N as a,O as o,R as s,T as c,_ as l,a as u,d,f,g as p,h as m,i as h,j as g,k as _,m as v,n as y,o as b,p as x,r as S,t as C,v as w,y as T}from"./app.js";var E=2.95325008,D=[{id:`sgra`,name:`Sagittarius A*`,massSun:4297e3,subtitle:`Supermassive black hole · centre of the Milky Way`,blurb:`Four million solar masses at the exact centre of our galaxy, weighed by tracking stars that orbit it at up to 3% of the speed of light. The Event Horizon Telescope imaged its shadow in 2022.`,anchor:()=>d.clone(),diskNormal:new e(.25,.92,.3).normalize(),diskOuter:13,diskTemp:5200,diskGain:1,notes:[`Mass: GRAVITY Collaboration (2022). The real accretion flow is hot, thick and faint; it is drawn here as a thin disc to show the relativistic optics.`]},{id:`m87`,name:`M87*`,massSun:65e8,subtitle:`Supermassive black hole · Virgo A`,blurb:`The first black hole ever imaged (EHT, 2019): 6.5 billion solar masses, with an event horizon larger than the orbit of Pluto, launching a jet 5,000 light-years long.`,anchor:t=>t.find(`M87`)?.anchor.clone()??f(187.706,12.391,168e5,new e),diskNormal:new e(-.4,.75,.52).normalize(),diskOuter:15,diskTemp:6e3,diskGain:1.1,notes:[`Mass and distance: Event Horizon Telescope Collaboration (2019). The relativistic jet is not modelled.`]},{id:`cygx1`,name:`Cygnus X-1`,massSun:21.2,subtitle:`Stellar-mass black hole · X-ray binary`,blurb:`The first widely accepted black hole: 21 solar masses, 7,200 light-years away, stripping gas from a blue supergiant companion. Its inner disc reaches millions of kelvin and shines in X-rays.`,anchor:()=>f(299.5903,35.2016,2220,new e),diskNormal:new e(.6,.7,-.38).normalize(),diskOuter:16,diskTemp:9e3,diskGain:1.2,notes:[`Mass and distance: Miller-Jones et al. (2021). The companion star HDE 226868 is not drawn; disc colours are shifted into the visible for display.`]}],O=46,k=[[new e(1,0,0),new e(0,-1,0)],[new e(-1,0,0),new e(0,-1,0)],[new e(0,1,0),new e(0,0,1)],[new e(0,-1,0),new e(0,0,-1)],[new e(0,0,1),new e(0,-1,0)],[new e(0,0,-1),new e(0,-1,0)]],A=class{app;holes=[];scene=new i;cam=new g(-1,1,1,-1,0,1);material;cube;active=-1;lastCapture=-1e9;captureFor=-1;time=0;distRs=0;constructor(r){this.app=r;let i=r.quality;this.cube=new T(i.name===`low`?512:1024,{type:c,minFilter:n,magFilter:n,generateMipmaps:!1,depthBuffer:!0}),this.material=new s({depthTest:!1,depthWrite:!1,transparent:!0,blending:1,defines:{STEPS:i.bhSteps},uniforms:{uEnv:{value:this.cube.texture},uCamPos:{value:new e},uCamRot:{value:new t},uTanHalf:{value:.5},uAspect:{value:1},uTime:{value:0},uDiskN:{value:new e(0,1,0)},uDiskOuter:{value:12},uDiskTemp:{value:6e3},uDiskGain:{value:1},uStepK:{value:i.bhSteps<120?.17:i.bhSteps<200?.11:.08}},vertexShader:`varying vec2 vNdc; void main(){ vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`,fragmentShader:`
        ${b}
        ${u}
        uniform samplerCube uEnv;
        uniform vec3 uCamPos; uniform mat3 uCamRot; uniform float uTanHalf, uAspect, uTime;
        uniform vec3 uDiskN; uniform float uDiskOuter, uDiskTemp, uDiskGain, uStepK;
        varying vec2 vNdc;
        const float BMAX = ${O.toFixed(1)};
        const float RIN = 3.0;                       // innermost stable circular orbit, in r_s

        // emission of the disc where a (backward-traced) ray with direction v crosses it at p
        vec4 disc(vec3 p, vec3 v, float rObs){
          float r = length(p);
          if (r < RIN || r > uDiskOuter) return vec4(0.0);
          // Shakura-Sunyaev: T ~ r^-3/4 (1 - sqrt(r_in/r))^1/4, peaking at r = 49/36 r_in
          float T = pow(r / RIN, -0.75) * pow(1.0 - sqrt(RIN / r), 0.25) / 0.4880;
          // circular-orbit speed measured by a static observer: beta = sqrt(r_s / (2 (r - r_s)))
          float beta = sqrt(0.5 / (r - 1.0));
          vec3 tang = normalize(cross(uDiskN, p));
          float gammaL = 1.0 / sqrt(1.0 - beta * beta);
          float doppler = 1.0 / (gammaL * (1.0 - beta * dot(tang, -normalize(v))));
          float grav = sqrt((1.0 - 1.0 / r) / max(1.0 - 1.0 / rObs, 1e-3));
          float g = doppler * grav;
          // turbulent structure sheared by differential (Keplerian) rotation; two phases cross-faded
          vec3 e1 = normalize(cross(uDiskN, vec3(0.31, 0.11, 0.94))); vec3 e2 = cross(uDiskN, e1);
          float phi = atan(dot(p, e2), dot(p, e1));
          float omega = sqrt(0.5 / (r * r * r));
          float dens = 0.0;
          for (int k = 0; k < 2; k++) {
            float ph = mod(uTime * 0.6 + float(k) * 40.0, 80.0);
            float w = 1.0 - abs(ph - 40.0) / 40.0;
            float a = phi - omega * ph * 14.0;
            vec3 q = vec3(cos(a) * r, sin(a) * r, float(k) * 7.0);
            dens += w * (0.55 + 0.45 * snoise(q * 0.9) + 0.3 * snoise(q * 2.7));
          }
          float edge = smoothstep(RIN, RIN + 0.25, r) * smoothstep(uDiskOuter, uDiskOuter * 0.62, r);
          float I = pow(g, 4.0) * pow(T, 4.0) * (0.35 + dens) * edge;
          vec3 col = blackbody(uDiskTemp * T * g) * I * uDiskGain * 0.42;
          return vec4(col, clamp(edge * (0.55 + 0.6 * dens), 0.0, 0.97));
        }

        void main(){
          vec3 rd = normalize(uCamRot * vec3(vNdc.x * uAspect * uTanHalf, vNdc.y * uTanHalf, -1.0));
          vec3 ro = uCamPos;
          float rObs = length(ro);
          float along = -dot(ro, rd);
          float b = length(cross(ro, rd));
          if (b > BMAX || (along < 0.0 && rObs > BMAX)) discard;
          float RS = max(BMAX * 1.25, 0.0);
          vec3 p = ro;
          if (rObs > RS) p = ro + rd * (along - sqrt(RS * RS - b * b));      // skip straight to the traced region
          vec3 v = rd;
          float h2 = dot(cross(p, v), cross(p, v));
          vec3 col = vec3(0.0);
          float trans = 1.0;
          bool captured = false;
          float escapeR = max(RS, rObs) * 1.02;
          for (int i = 0; i < STEPS; i++) {
            float r = length(p);
            if (r < 1.0) { captured = true; break; }
            if (r > escapeR && dot(p, v) > 0.0) break;
            float dt = uStepK * r * clamp((r - 0.85) * 1.2, 0.12, 1.0);
            vec3 a0 = -1.5 * h2 * p / pow(r, 5.0);
            vec3 pn = p + v * dt + 0.5 * a0 * dt * dt;
            float rn = length(pn);
            vec3 a1 = -1.5 * h2 * pn / pow(rn, 5.0);
            vec3 vn = v + 0.5 * (a0 + a1) * dt;
            float y0 = dot(p, uDiskN), y1 = dot(pn, uDiskN);
            if (y0 * y1 < 0.0) {
              vec3 hit = mix(p, pn, y0 / (y0 - y1));
              vec4 d = disc(hit, mix(v, vn, y0 / (y0 - y1)), rObs);
              col += trans * d.rgb;
              trans *= 1.0 - d.a;
              if (trans < 0.01) break;
            }
            p = pn; v = vn;
          }
          if (!captured) {
            // gravitational blueshift of infalling starlight seen by a static observer near the hole
            float boost = 1.0 / max(1.0 - 1.0 / rObs, 0.05);
            col += trans * textureCube(uEnv, normalize(v)).rgb * min(boost, 3.0);
          }
          float alpha = smoothstep(BMAX, BMAX * 0.72, b);
          gl_FragColor = vec4(col, alpha);
        }`});let o=new _(new a(2,2),this.material);o.frustumCulled=!1,this.scene.add(o);for(let t of D){let n=new h(`bh:${t.id}`,t.name,`blackhole`);n.anchor.copy(t.anchor(r));let i=t.massSun*E;n.radiusKm=i,n.minDistKm=i*2.2,n.viewDistKm=i*30,n.subtitle=t.subtitle,n.rank=97,n.color=16763274,n.getInfo=()=>this.info(t,n,i),this.holes.push({def:t,entity:n,rsKm:i,rel:new e}),r.registerEntity(n),r.addSearch({text:`${t.name} black hole ${t.id===`sgra`?`sgr a* galactic centre`:``}`.toLowerCase(),label:t.name,sub:`Black hole`,weight:185,get:()=>n})}r.engine.systems.push(this),r.labelSystems.push(this),r.engine.beforeNear=(e,t)=>this.render(e,t)}info(e,t,n){let r=t.anchor.length()*w,i=46.17*n/v,a=Math.sqrt(27)*n,o=this.active>=0&&this.holes[this.active].entity===t?this.distRs:NaN,s=[{k:`Mass`,v:`${S(e.massSun,3)} M☉`},{k:`Schwarzschild radius rₛ`,v:C(n),hint:n>1e6?`${S(n/x,3)} AU`:void 0},{k:`Photon sphere`,v:`1.5 rₛ`,hint:C(n*1.5)},{k:`Shadow diameter`,v:`${S(Math.sqrt(27),4)} rₛ`,hint:C(a)},{k:`Innermost stable orbit`,v:`3 rₛ`,hint:`period ${y(i/86400)}`},{k:`Shadow seen from Earth`,v:`${S(a/r*2062648e5,3)} µas`},{k:`Distance from Sun`,v:r>0x1ac394a1e11cb4000?`${S(r/p/1e6,3)} million ly`:`${S(r/p,3)} ly`,hint:r>0x1ac394a1e11cb4000?`${S(r/l,3)} Mpc`:`${S(r/m,3)} kpc`}];return isFinite(o)&&o>1&&(s.push({k:`Your distance`,v:`${S(o,3)} rₛ`}),s.push({k:`Time dilation here`,v:`${S(Math.sqrt(1-1/o),4)}`,hint:`seconds per far-away second`}),o>1.5&&s.push({k:`Circular orbit speed here`,v:`${S(Math.sqrt(.5/(o-1)),3)} c`})),{title:e.name,subtitle:e.subtitle,blurb:e.blurb,rows:s,notes:[...e.notes,`Light paths: Schwarzschild (non-rotating) geodesics traced per pixel. The background is the real sky around the hole, bent by its gravity.`]}}update(e){this.time=e.time;let t=-1,n=0;if(this.holes.forEach((r,i)=>{e.rel(r.entity,r.rel);let a=r.rsKm/Math.max(r.rel.length(),1);a>n&&(n=a,t=i)}),this.active=n*e.pixelScale>.35?t:-1,this.active<0)return;let r=this.holes[this.active],i=this.material.uniforms;i.uCamPos.value.copy(r.rel).multiplyScalar(-1/r.rsKm),this.distRs=r.rel.length()/r.rsKm;let a=this.app.engine.near.camera;i.uCamRot.value.setFromMatrix4(new o().makeRotationFromQuaternion(a.quaternion)),i.uTanHalf.value=Math.tan(a.fov*Math.PI/360),i.uAspect.value=a.aspect,i.uTime.value=e.time,i.uDiskN.value.copy(r.def.diskNormal),i.uDiskOuter.value=r.def.diskOuter,i.uDiskTemp.value=r.def.diskTemp,i.uDiskGain.value=r.def.diskGain}capture(t){let n=this.app.engine.layers.filter(e=>e.name!==`near`),i=n.map(e=>({q:e.camera.quaternion.clone(),fov:e.camera.fov,aspect:e.camera.aspect})),a=new o,s=new r,c=new e;for(let e=0;e<6;e++){a.lookAt(c,k[e][0],k[e][1]),s.setFromRotationMatrix(a),t.setRenderTarget(this.cube,e),t.setClearColor(0,1),t.clear(!0,!0,!1);for(let e of n)e.camera.quaternion.copy(s),e.camera.fov=90,e.camera.aspect=1,e.camera.updateProjectionMatrix(),e.camera.updateMatrixWorld(!0),t.clearDepth(),t.render(e.scene,e.camera)}n.forEach((e,t)=>{e.camera.quaternion.copy(i[t].q),e.camera.fov=i[t].fov,e.camera.aspect=i[t].aspect,e.camera.updateProjectionMatrix(),e.camera.updateMatrixWorld(!0)})}render(e,t){this.active<0||((this.captureFor!==this.active||this.time-this.lastCapture>4)&&(this.capture(e),this.captureFor=this.active,this.lastCapture=this.time),e.setRenderTarget(t),e.render(this.scene,this.cam))}labels(e,t){let n={x:0,y:0};for(let r of this.holes){let i=r.rel.length(),a=r.rsKm*2.6/Math.max(i,1)*e.pixelScale/e.pixelRatio,o=e.rig.target===r.entity,s=i<(r.def.id===`sgra`?600*w:r.def.id===`m87`?3*l:900*w);(o||s)&&e.project(r.rel,n)&&t({x:n.x,y:n.y,text:r.def.name,priority:o?1200:94,color:`#ffc98a`,entity:r.entity,offset:Math.min(120,Math.max(8,a+6)),kind:`star`,key:`bh${r.def.id}`})}}};function j(e){new A(e)}export{j as installBlackHoles};