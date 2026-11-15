// Shared GLSL chunks.

export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
// Simplex noise (Ashima Arts / Ian McEwan, MIT licence)
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){
  float a=0.5, s=0.0;
  for(int i=0;i<5;i++){ s+=a*snoise(p); p=p*2.03+vec3(17.1,3.7,9.2); a*=0.5; }
  return s;
}
float hash11(float n){ return fract(sin(n*127.1)*43758.5453123); }
float hash21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
vec3 hash33(vec3 p){
  p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));
  return fract(sin(p)*43758.5453123);
}
`;

/** Black-body chromaticity in linear sRGB (Planckian locus: Krystek 1985), max channel = 1. */
export const BLACKBODY = /* glsl */ `
vec3 blackbody(float T){
  T=clamp(T,1000.0,40000.0);
  float u=(0.860117757+1.54118254e-4*T+1.28641212e-7*T*T)/(1.0+8.42420235e-4*T+7.08145163e-7*T*T);
  float v=(0.317398726+4.22806245e-5*T+4.20481691e-8*T*T)/(1.0-2.89741816e-5*T+1.61456053e-7*T*T);
  float d=2.0*u-8.0*v+4.0; float x=3.0*u/d; float y=2.0*v/d;
  float X=x/y; float Z=(1.0-x-y)/y;
  vec3 c=vec3(3.2406*X-1.5372-0.4986*Z, -0.9689*X+1.8758+0.0415*Z, 0.0557*X-0.2040+1.0570*Z);
  c=max(c,vec3(0.0));
  return c/max(max(c.r,c.g),max(c.b,1e-4));
}
// Ballesteros (2012)
float bvToTeff(float bv){ return 4600.0*(1.0/(0.92*bv+1.7)+1.0/(0.92*bv+0.62)); }
`;

export const LOGDEPTH_VERT_PARS = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
`;
export const LOGDEPTH_VERT = /* glsl */ `
#include <logdepthbuf_vertex>
`;
export const LOGDEPTH_FRAG_PARS = /* glsl */ `
#include <logdepthbuf_pars_fragment>
`;
export const LOGDEPTH_FRAG = /* glsl */ `
#include <logdepthbuf_fragment>
`;
