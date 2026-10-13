import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from astropy.table import Table
U='/home/thomas/.claude/uploads/e89f2b33-75d7-59b5-88f7-b77d7d16fd01/'
F={'S3':'94f2c76a','N1':'43e7e531','N2':'acb658a7','N3':'6e31c999'}
# polygons in thumbnail (1/3) coords
P={'S3':[[(0,0),(858,0),(858,235),(770,243),(700,255),(655,285),(630,330),(610,395),(560,415),(520,420),(500,400),(455,332),(430,342),(410,360),(360,337),(330,362),(325,395),(270,403),(250,390),(160,368),(50,400),(0,410)]],
   'N1':[[(240,0),(644,0),(644,435),(445,448),(330,490),(160,485),(85,450),(80,440),(120,290)]],
   'N2':[[(0,0),(858,0),(858,285),(800,305),(740,330),(640,390),(600,410),(540,420),(440,435),(330,448),(315,435),(240,372),(170,368),(0,368)]],
   'N3':[[(0,0),(495,0),(548,340),(572,520),(555,550),(470,552),(340,578),(200,612),(110,638),(0,670)]]}
EXCL={'S3':[[(800,0),(858,0),(858,40),(800,10)]],'N2':[[(70,0),(610,0),(610,185),(430,175),(300,130),(90,105)]]}
def mask(n,size):
    m=Image.new('L',size,0); d=ImageDraw.Draw(m)
    for p in P[n]: d.polygon([(x*3,y*3) for x,y in p],fill=1)
    for p in EXCL.get(n,[]): d.polygon([(x*3,y*3) for x,y in p],fill=0)
    return np.array(m,bool)
import sys
thr=float(sys.argv[1]) if len(sys.argv)>1 else 5
only=sys.argv[2].split(',') if len(sys.argv)>2 else list(F)
for n in only:
    im=np.asarray(Image.open(U+F[n]+'-image.jpg').convert('L')).astype(float)
    m=mask(n,im.shape[::-1]); m=ndi.binary_erosion(m,iterations=8)
    bg=ndi.median_filter(im[::4,::4],size=13); bg=np.kron(bg,np.ones((4,4)))[:im.shape[0],:im.shape[1]]
    d=ndi.gaussian_filter(im-bg,1.2)
    sd=1.4826*np.median(abs(d[m]-np.median(d[m])))
    pk=(d==ndi.maximum_filter(d,size=9))&(d>max(thr*sd,3.0))&m
    ys,xs=np.nonzero(pk); out=[]
    for x,y in zip(xs,ys):
        if x<4 or y<4 or y>im.shape[0]-5 or x>im.shape[1]-5: continue
        w=np.clip((im-bg)[y-3:y+4,x-3:x+4],0,None)
        if w.sum()<=0: continue
        cy,cx=np.mgrid[-3:4,-3:4]; out.append((x+(w*cx).sum()/w.sum()+1,y+(w*cy).sum()/w.sum()+1,w.sum()))
    t=Table(rows=out,names=('X','Y','FLUX')); t.sort('FLUX',reverse=True); t.write(n+('_xy.fits' if thr>=5 else '_xy_lo.fits'),overwrite=True)
    Image.fromarray((m*255).astype('uint8')).resize((im.shape[1]//3,im.shape[0]//3)).save(n+'_mask.png')
    print(n,len(t),sd)
