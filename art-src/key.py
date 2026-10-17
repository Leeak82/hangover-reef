import numpy as np, sys
from PIL import Image
from scipy import ndimage as nd
def key(name, maxside=512):
    im = np.asarray(Image.open(name+'.jpg').convert('RGB')).astype(np.float32)
    h,w,_ = im.shape
    border = np.concatenate([im[:8].reshape(-1,3), im[-8:].reshape(-1,3), im[:,:8].reshape(-1,3), im[:,-8:].reshape(-1,3)])
    k = np.median(border,axis=0)
    d = np.sqrt(((im-k)**2).sum(-1))
    bglike = d < 115
    lab,_ = nd.label(bglike)
    edge_labels = set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]]))) - {0}
    bg = np.isin(lab, list(edge_labels))
    lab2,n2 = nd.label((d<55)&~bg)
    sizes = nd.sum(np.ones_like(d), lab2, range(1,n2+1))
    holes = np.isin(lab2, [i+1 for i,s in enumerate(sizes) if s>30])
    bg = bg | nd.binary_dilation(holes, iterations=1) & bglike
    near = nd.binary_dilation(bg, iterations=3)
    a = np.ones((h,w),np.float32)
    t = np.clip((d-45)/(125-45),0,1); t = t*t*(3-2*t)
    a[near] = t[near]
    a[bg & (d<60)] = 0
    # despill on edge
    out = im.copy()
    e = near & ~bg | (near & (a>0))
    if k[1] > max(k[0],k[2]):  # green key
        lim = np.maximum(out[...,0], out[...,2])
        g = out[...,1]; out[...,1] = np.where(e, np.minimum(g, lim*1.05), g)
    else:  # magenta
        lim = out[...,1]
        mn = np.minimum(out[...,0], out[...,2])
        excess = np.clip(mn - lim - 20, 0, None)
        for c in (0,2): out[...,c] = np.where(e, out[...,c]-excess*0.85, out[...,c])
    a = nd.gaussian_filter(a, 0.6)
    rgba = np.dstack([np.clip(out,0,255), a*255]).astype(np.uint8)
    ys,xs = np.where(a>0.05)
    rgba = rgba[max(ys.min()-4,0):ys.max()+5, max(xs.min()-4,0):xs.max()+5]
    img = Image.fromarray(rgba,'RGBA')
    s = maxside/max(img.size)
    if s<1: img = img.resize((int(img.width*s), int(img.height*s)), Image.LANCZOS)
    img.save(f'../client/public/assets/{name}.png', optimize=True)
    print(name, img.size, k)
for n in ['clownfish','puffer','crab','shark','turtle','octopus','jelly','lobster','sardine','seahorse','cannon']:
    key(n, 384 if n in ('sardine','seahorse','clownfish') else 512)
key('whale', 900); key('logo', 900)
Image.open('bg.jpg').convert('RGB').resize((1920,1080), Image.LANCZOS).save('../client/public/assets/bg.jpg', quality=86)
