import numpy as np, sys
from PIL import Image
from scipy import ndimage as ndi
from astropy.table import Table
U='/home/thomas/.claude/uploads/e89f2b33-75d7-59b5-88f7-b77d7d16fd01/'
F={'A':U+'8d611fa1-image.jpg','B':U+'1863d65a-image.jpg'}
def mask(n,shape):
    m=np.zeros(shape,bool); H,W=shape
    yy,xx=np.mgrid[:H,:W]
    if n=='A':
        m=(yy<1700)&~((xx<520)&(yy<1000))
    else:
        m=(yy<1900)&~((xx>1600)&(yy<950))&~((xx>1050)&(yy>1350))&~((xx<450)&(yy>1550))
        m&=(yy<1550)|((xx>450)&(xx<1050)&(yy<1900))
        m&=(yy<2050)
    return m
for n in 'AB':
    im=np.asarray(Image.open(F[n]).convert('L')).astype(float)
    m=mask(n,im.shape)
    bg=ndi.median_filter(im[::2,::2],size=25); bg=np.kron(bg,np.ones((2,2)))[:im.shape[0],:im.shape[1]]
    d=ndi.gaussian_filter(im-bg,1.2)
    sd=1.4826*np.median(abs(d[m]-np.median(d[m])))
    pk=(d==ndi.maximum_filter(d,size=9))&(d>6*sd)&m
    ys,xs=np.nonzero(pk); fl=d[ys,xs]
    # centroid refine
    out=[]
    for x,y,f in zip(xs,ys,fl):
        if x<4 or y<4 or y>im.shape[0]-5 or x>im.shape[1]-5: continue
        w=np.clip((im-bg)[y-3:y+4,x-3:x+4],0,None); 
        if w.sum()<=0: continue
        cy,cx=np.mgrid[-3:4,-3:4]; out.append((x+(w*cx).sum()/w.sum()+1,y+(w*cy).sum()/w.sum()+1,w.sum()))
    t=Table(rows=out,names=('X','Y','FLUX')); t.sort('FLUX',reverse=True)
    t.write(n+'_xy.fits',overwrite=True); print(n,len(t),sd)
