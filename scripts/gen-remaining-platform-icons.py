from PIL import Image, ImageDraw, ImageFilter
import math, os

ROOT='/home/rahman/projects/mso/public/app-icons'
S=768

def lerp(a,b,t): return int(a+(b-a)*t)
def gradient(c1,c2):
    im=Image.new('RGB',(S,S)); p=im.load()
    for y in range(S):
        t=y/(S-1); c=tuple(lerp(c1[i],c2[i],t) for i in range(3))
        for x in range(S): p[x,y]=c
    return im.convert('RGBA')
def rrect(d,b,r,f): d.rounded_rectangle(b,radius=r,fill=f)
def capsule(d,b,f): d.rounded_rectangle(b,radius=(b[3]-b[1])//2,fill=f)
def shadow(base,b,r,blur=24,dy=18,alpha=70):
    sh=Image.new('RGBA',(S,S)); d=ImageDraw.Draw(sh); x0,y0,x1,y1=b
    d.rounded_rectangle((x0,y0+dy,x1,y1+dy),radius=r,fill=(0,0,0,alpha))
    base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(blur)))
def sparkle(d,cx,cy,r,color):
    pts=[]
    for i in range(8):
        a=-math.pi/2+i*math.pi/4; rr=r if i%2==0 else r*.28
        pts.append((cx+math.cos(a)*rr,cy+math.sin(a)*rr))
    d.polygon(pts,fill=color)
def canvas(osname):
    if osname=='macos':
        im=gradient((252,252,253),(231,236,246)); d=ImageDraw.Draw(im)
        d.rounded_rectangle((18,18,S-18,S-18),radius=168,outline=(130,145,170,35),width=5)
        return im
    im=gradient((35,43,61),(16,24,38)); d=ImageDraw.Draw(im)
    d.rounded_rectangle((18,18,S-18,S-18),radius=132,outline=(255,255,255,24),width=4)
    return im
def save(im,osname,name):
    p=f'{ROOT}/{osname}/{name}.webp'; os.makedirs(os.path.dirname(p),exist_ok=True)
    im.resize((256,256),Image.Resampling.LANCZOS).convert('RGB').save(p,'WEBP',quality=84,method=6)

def claude(o):
    im=canvas(o); b=(145,170,623,598); shadow(im,b,76,22,14,75 if o=='macos' else 110); d=ImageDraw.Draw(im)
    rrect(d,b,76,(37,40,49,255) if o=='macos' else (25,31,44,255))
    cols=[(255,95,87,255),(255,189,46,255),(40,200,64,255)] if o=='macos' else [(94,108,140,255)]*3
    for i,c in enumerate(cols): d.ellipse((185+i*52,205,211+i*52,231),fill=c)
    capsule(d,(214,355,292,372),(238,241,247,255)); capsule(d,(278,335,296,390),(238,241,247,255))
    d.ellipse((415,300,550,435),fill=(112,78,245,255) if o=='macos' else (47,121,255,255)); sparkle(d,482,367,48,(255,255,255,255)); return im
def reel(o):
    im=canvas(o); b=(145,210,623,570); shadow(im,b,64,22,16,75 if o=='macos' else 110); d=ImageDraw.Draw(im)
    rrect(d,b,64,(60,63,74,255) if o=='macos' else (76,52,155,255)); d.rounded_rectangle((165,160,608,286),radius=30,fill=(30,34,43,255) if o=='macos' else (39,46,68,255))
    for x in [190,310,430,550]: d.polygon([(x,160),(x+58,160),(x+15,286),(x-43,286)],fill=(245,246,249,255))
    rrect(d,(250,335,520,505),42,(166,64,235,255) if o=='macos' else (87,73,230,255)); d.polygon([(350,372),(350,468),(442,420)],fill=(255,255,255,245)); return im
def viewer(o):
    im=canvas(o); b=(160,160,608,608); shadow(im,b,70,22,15,70 if o=='macos' else 100); d=ImageDraw.Draw(im)
    rrect(d,b,70,(44,156,232,255) if o=='macos' else (33,91,181,255)); rrect(d,(190,190,578,520),48,(154,220,255,255) if o=='macos' else (83,154,230,255)); d.ellipse((438,245,505,312),fill=(255,220,88,255))
    d.polygon([(190,475),(310,332),(390,420),(455,350),(578,500),(578,520),(190,520)],fill=(35,92,185,255)); d.polygon([(190,495),(285,402),(345,455),(408,392),(515,520),(190,520)],fill=(66,130,224,255)); return im
def create(o):
    im=canvas(o); b=(160,160,608,608); shadow(im,b,70,22,15,70 if o=='macos' else 105); d=ImageDraw.Draw(im); rrect(d,b,70,(105,87,235,255) if o=='macos' else (44,101,213,255))
    for x,y in [(220,235),(370,235),(220,385),(370,385)]: rrect(d,(x,y,x+105,y+105),30,(245,247,253,245))
    d.polygon([(422,235),(475,288),(422,341),(369,288)],fill=(213,220,255,255)); sparkle(d,538,210,62,(255,255,255,255)); return im
def links(o):
    im=canvas(o); d=ImageDraw.Draw(im); d.ellipse((185,220,435,470),fill=(115,83,241,255) if o=='macos' else (46,102,224,255)); d.ellipse((333,300,583,550),fill=(72,129,244,255) if o=='macos' else (104,70,230,255))
    capsule(d,(245,300,455,380),(255,255,255,245)); capsule(d,(355,390,545,470),(255,255,255,245)); capsule(d,(282,323,420,357),(101,92,230,255) if o=='macos' else (39,78,175,255)); capsule(d,(390,413,510,447),(75,114,235,255) if o=='macos' else (80,62,180,255)); return im
def hermes(o):
    im=canvas(o); d=ImageDraw.Draw(im); d.ellipse((285,285,483,483),fill=(112,79,244,255) if o=='macos' else (45,111,224,255)); wing=(255,255,255,242)
    d.polygon([(300,345),(175,275),(210,350),(145,350),(255,435)],fill=wing); d.polygon([(468,345),(593,275),(558,350),(623,350),(513,435)],fill=wing); d.ellipse((322,325,446,449),fill=(238,241,249,255)); d.rectangle((350,385,418,445),fill=(238,241,249,255)); d.ellipse((367,348,401,382),fill=(91,116,247,255)); return im
def openclaw(o):
    im=canvas(o); d=ImageDraw.Draw(im); col=(244,96,55,255) if o=='macos' else (255,114,51,255); d.ellipse((286,388,482,570),fill=(87,45,46,255) if o=='macos' else (84,48,39,255))
    for off in [-105,0,105]:
        x=384+off; d.polygon([(x-42,175),(x+15,160),(x+65,372),(x+18,390)],fill=col); d.polygon([(x-20,190),(x+8,182),(x+42,325),(x+20,332)],fill=(255,170,102,160))
    return im

for osname in ('macos','windows'):
    for name,fn in {'claude':claude,'reel':reel,'viewer':viewer,'create':create,'links':links,'hermes':hermes,'openclaw':openclaw}.items(): save(fn(osname),osname,name)
print('generated 14 raster WebP icons')
