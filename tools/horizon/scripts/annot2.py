import json, subprocess, re, numpy as np, warnings
warnings.filterwarnings("ignore")
from PIL import Image, ImageDraw, ImageFont
import astropy.units as u
from astropy.coordinates import SkyCoord, AltAz, get_body
from astropy.time import Time
from pix2radec import load, radec2pix, pix2radec
from pix2altaz import SITE, DEFAULT_TIME, radec_to_altaz
import sys
U='/home/thomas/.claude/uploads/e89f2b33-75d7-59b5-88f7-b77d7d16fd01/'
name,imgf,TIME=sys.argv[1],sys.argv[2],sys.argv[3]
F={name:imgf}
W,H=Image.open(imgf).size
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',26)
fs=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
t=Time(TIME)
sat=get_body('saturn',t,SITE); sat=sat.icrs
print('Saturn RA/Dec',sat.ra.deg,sat.dec.deg)
def inim(x,y): return -50<x<W+50 and -50<y<H+50
def polyline(d,pts,col,wd=2):
    seg=[]
    for p in pts:
        if p is not None and inim(*p): seg.append(p)
        else:
            if len(seg)>1: d.line(seg,fill=col,width=wd)
            seg=[]
    if len(seg)>1: d.line(seg,fill=col,width=wd)
for n in [name]:
    w=load(n+'.wcs')
    im=Image.open(F[n]).convert('RGB')
    # star list
    out=subprocess.run(['plot-constellations','-w',n+'.wcs','-L','-B','-J'],capture_output=True,text=True)
    js=json.loads(out.stderr[out.stderr.index('{'):]) if '{' in out.stderr else json.loads(out.stdout[out.stdout.index('{'):])
    stars=[a for a in js['annotations'] if a['type']=='star' and 0<=a['pixelx']<W and 0<=a['pixely']<H]
    print(n,len(stars),'catalog bright stars in frame')
    from astropy.table import Table
    T=Table.read(n+'_xy.fits'); sx=np.array(T['X'])-1; sy=np.array(T['Y'])-1; sf=np.array(T['FLUX'])
    sel=[]; res=[]
    for s_ in stars:
        dd=np.hypot(sx-s_['pixelx'],sy-s_['pixely']); i=dd.argmin()
        if dd[i]<20: sel.append((sf[i],s_)); res.append(dd[i])
    sel.sort(key=lambda t:-t[0]); stars=[s_ for f_,s_ in sel[:45]]
    print(n,'named stars matched to detections:',len(sel),'median offset px',np.median(res))
    json.dump(stars,open(n+'_stars.json','w'))
    def make(kind):
        img=im.copy(); d=ImageDraw.Draw(img,'RGBA')
        if kind=='annot':
            for ra in range(0,360,15):
                pts=[]
                for dec in np.arange(-89,89.1,1.0):
                    x,y=radec2pix(w,ra,dec); pts.append((x[0],y[0]) if np.isfinite(x[0]) else None)
                polyline(d,pts,(80,200,255,110))
                for p in pts:
                    if p and 100<p[0]<W-100 and 100<p[1]<H-100: d.text(p,f'{ra//15}h',fill=(120,220,255,255),font=fs); break
            for dec in range(-80,90,10):
                pts=[]
                for ra in np.arange(0,360.1,1.0):
                    x,y=radec2pix(w,ra,dec); pts.append((x[0],y[0]) if np.isfinite(x[0]) else None)
                polyline(d,pts,(80,255,150,110))
                for p in pts:
                    if p and 100<p[0]<W-100 and 100<p[1]<H-100: d.text(p,f'{dec:+d}',fill=(140,255,180,255),font=fs); break
            # labelled stars
            def mag(s): return 0
            for s in stars:
                x,y=s['pixelx'],s['pixely']
                nm=s['name'].split(' / ')[0]
                d.ellipse([x-18,y-18,x+18,y+18],outline=(255,60,60,255),width=2)
                d.text((x+22,y-12),nm,fill=(255,230,80,255),font=fs)
        else:
            # alt/az grid
            for alt in range(0,90,5):
                pts=[]
                for az in np.arange(0,360.1,1.0):
                    pts.append((az,alt))
                a=np.array(pts)
                c=SkyCoord(az=a[:,0]*u.deg,alt=a[:,1]*u.deg,frame=AltAz(obstime=t,location=SITE)).icrs
                x,y=radec2pix(w,c.ra.deg,c.dec.deg)
                P=[(xx,yy) if np.isfinite(xx) else None for xx,yy in zip(x,y)]
                col=(255,120,0,230) if alt==0 else ((255,180,60,170) if alt%10==0 else (255,180,60,80))
                polyline(d,P,col,3 if alt==0 else 2)
                for p in P:
                    if p and 80<p[0]<W-80 and 80<p[1]<H-80: d.text(p,f'alt {alt}',fill=(255,200,100,255),font=fs); break
            for az in range(0,360,10):
                a=np.array([(az,al) for al in np.arange(0,90.1,1.0)])
                c=SkyCoord(az=a[:,0]*u.deg,alt=a[:,1]*u.deg,frame=AltAz(obstime=t,location=SITE)).icrs
                x,y=radec2pix(w,c.ra.deg,c.dec.deg)
                P=[(xx,yy) if np.isfinite(xx) else None for xx,yy in zip(x,y)]
                lab={0:'N',90:'E',180:'S',270:'W'}.get(az,f'{az}')
                polyline(d,P,(120,200,255,140) if az%90 else (255,80,80,220),2)
                for p in P:
                    if p and 80<p[0]<W-80 and 80<p[1]<H-80: d.text(p,f'az {lab}',fill=(150,220,255,255),font=fs); break
            for s in stars[:25]:
                d.ellipse([s['pixelx']-10,s['pixely']-10,s['pixelx']+10,s['pixely']+10],outline=(255,60,60,255),width=2)
        x,y=radec2pix(w,sat.ra.deg,sat.dec.deg)
        if inim(x[0],y[0]) : 
            d.ellipse([x[0]-30,y[0]-30,x[0]+30,y[0]+30],outline=(255,0,255,255),width=3); d.text((x[0]+34,y[0]),'Saturn(pred)',fill=(255,120,255,255),font=font)
        print(n,'Saturn pixel',x[0],y[0])
        return img
    make('annot').save(n+'_annot.jpg',quality=90)
    make('altaz').save(n+'_altaz.jpg',quality=90)
