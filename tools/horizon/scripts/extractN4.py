import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from astropy.table import Table
im=np.asarray(Image.open('/home/thomas/.claude/uploads/e89f2b33-75d7-59b5-88f7-b77d7d16fd01/463f57c1-image.jpg').convert('L')).astype(float)
H,W=im.shape
P=[(0,0),(858,0),(858,330),(820,345),(760,505),(700,515),(660,572),(480,580),(330,555),(300,530),(215,395),(190,392),(135,450),(0,455)]
m=Image.new('L',(W,H),0); ImageDraw.Draw(m).polygon([(x*3,y*3) for x,y in P],fill=1)
m=ndi.binary_erosion(np.array(m,bool),iterations=10)
bg=ndi.gaussian_filter(im,8)            # removes stars, keeps contrails/gradient
d=ndi.gaussian_filter(im,1.3)-bg
# local noise incl. contrail texture
sd=np.sqrt(ndi.uniform_filter(d*d,61))
pk=(d==ndi.maximum_filter(d,size=11))&(d>5*sd)&(d>2.0)&m
ys,xs=np.nonzero(pk); out=[]
for x,y in zip(xs,ys):
    if x<4 or y<4 or y>H-5 or x>W-5: continue
    w=np.clip((im-bg)[y-3:y+4,x-3:x+4],0,None)
    if w.sum()<=0: continue
    cy,cx=np.mgrid[-3:4,-3:4]; out.append((x+(w*cx).sum()/w.sum()+1,y+(w*cy).sum()/w.sum()+1,w.sum()))
t=Table(rows=out,names=('X','Y','FLUX')); t.sort('FLUX',reverse=True); t.write('N4_xy.fits',overwrite=True); print(len(t))
imc=Image.open('/home/thomas/.claude/uploads/e89f2b33-75d7-59b5-88f7-b77d7d16fd01/463f57c1-image.jpg').convert('RGB'); dr=ImageDraw.Draw(imc)
for i,(x,y) in enumerate(zip(t['X'],t['Y'])):
    r=22 if i<40 else 13; dr.ellipse([x-r,y-r,x+r,y+r],outline=(255,0,0) if i<40 else (0,255,0),width=3)
imc.resize((W//3,H//3)).save('N4_src.jpg')
