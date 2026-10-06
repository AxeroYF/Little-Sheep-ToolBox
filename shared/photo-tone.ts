import type {PhotoEdits} from './photos';
// Self-contained so the same pure pixel transform can run inside an isolated worker.
export function tonePixels(buffer:ArrayBuffer,linear:boolean,edits:PhotoEdits) {
  const pixels=new Uint16Array(buffer),lut=new Uint16Array(65536),gain=2**edits.exposure,contrast=2**(edits.contrast/100),sat=1+edits.saturation/100;
  for(let i=0;i<65536;i++) {
    let v=i/65535;
    if(!linear)v=v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
    v*=gain;
    // Smooth global tonal controls in linear RGB, followed by standard sRGB encoding.
    const clamped=Math.min(1,Math.max(0,v));
    v+=edits.shadows/100*.3*Math.sqrt(clamped)*(1-clamped)**3;
    v+=edits.highlights/100*.3*clamped**2;
    v=Math.min(1,Math.max(0,v));v=v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055;
    v=(v-.5)*contrast+.5;lut[i]=Math.round(Math.min(1,Math.max(0,v))*65535);
  }
  const rGain=linear?1:Math.exp(edits.temperature*.003),bGain=linear?1:Math.exp(-edits.temperature*.003),gGain=linear?1:Math.exp(-edits.tint*.002);
  for(let i=0;i<pixels.length;i+=3){const r=lut[pixels[i]]*rGain,g=lut[pixels[i+1]]*gGain,b=lut[pixels[i+2]]*bGain,y=.2126*r+.7152*g+.0722*b;pixels[i]=Math.round(Math.min(65535,Math.max(0,y+(r-y)*sat)));pixels[i+1]=Math.round(Math.min(65535,Math.max(0,y+(g-y)*sat)));pixels[i+2]=Math.round(Math.min(65535,Math.max(0,y+(b-y)*sat)));}
  return buffer;
}
