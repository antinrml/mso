from PIL import Image, ImageDraw, ImageFilter
import math
import numpy as np
from pathlib import Path

S=1024

def rgba(c, a=255):
    if len(c)==4: return c
    return (*c,a)

def lerp_color(c1,c2,t):
    return tuple(round(c1[i]+(c2[i]-c1[i])*t) for i in range(4))

def linear_gradient(size, c1, c2, start=(0,0), end=(1,1)):
    w, h = size
    c1 = np.asarray(rgba(c1), dtype=np.float32)
    c2 = np.asarray(rgba(c2), dtype=np.float32)
    sx, sy = start[0] * w, start[1] * h
    ex, ey = end[0] * w, end[1] * h
    vx, vy = ex - sx, ey - sy
    denominator = vx * vx + vy * vy or 1.0
    yy, xx = np.mgrid[0:h, 0:w]
    t = np.clip(((xx - sx) * vx + (yy - sy) * vy) / denominator, 0.0, 1.0)
    pixels = c1[None, None, :] + (c2 - c1)[None, None, :] * t[..., None]
    return Image.fromarray(np.rint(pixels).astype(np.uint8), 'RGBA')

def radial_gradient(size, inner, outer, center=(0.5,0.45), radius=0.7):
    w, h = size
    inner = np.asarray(rgba(inner), dtype=np.float32)
    outer = np.asarray(rgba(outer), dtype=np.float32)
    cx, cy = center[0] * w, center[1] * h
    yy, xx = np.mgrid[0:h, 0:w]
    t = np.clip(np.hypot(xx - cx, yy - cy) / (radius * max(w, h)), 0.0, 1.0)
    pixels = inner[None, None, :] + (outer - inner)[None, None, :] * t[..., None]
    return Image.fromarray(np.rint(pixels).astype(np.uint8), 'RGBA')

def mask_roundrect(box, radius):
    m=Image.new('L',(S,S),0); d=ImageDraw.Draw(m)
    d.rounded_rectangle(box,radius=radius,fill=255)
    return m

def mask_ellipse(box):
    m=Image.new('L',(S,S),0); ImageDraw.Draw(m).ellipse(box,fill=255); return m

def paste_mask(base, fill, mask):
    if isinstance(fill, tuple):
        layer=Image.new('RGBA',(S,S),fill)
    else:
        layer=fill
    base.alpha_composite(Image.composite(layer, Image.new('RGBA',(S,S)), mask))

def shadow_from_mask(base, mask, offset=(0,30), blur=32, color=(0,0,0,90)):
    sh=Image.new('RGBA',(S,S),(0,0,0,0))
    colored=Image.new('RGBA',(S,S),color)
    shifted=Image.new('L',(S,S),0)
    shifted.paste(mask,(offset[0],offset[1]))
    shifted=shifted.filter(ImageFilter.GaussianBlur(blur))
    sh=Image.composite(colored,sh,shifted)
    base.alpha_composite(sh)

def draw_line(draw, points, fill, width, joint="curve"):
    draw.line(points, fill=fill, width=width, joint=joint)

def rounded_polygon_mask(points, radius=0):
    m=Image.new('L',(S,S),0); ImageDraw.Draw(m).polygon(points,fill=255); return m

def draw_sparkle(draw,cx,cy,r,fill,inner=0.28,points=4,angle=-math.pi/2):
    pts=[]
    for i in range(points*2):
        a=angle+i*math.pi/points
        rr=r if i%2==0 else r*inner
        pts.append((cx+math.cos(a)*rr,cy+math.sin(a)*rr))
    draw.polygon(pts,fill=fill)

def mac_canvas(top,bottom, accent=None):
    im=Image.new('RGBA',(S,S),(0,0,0,0))
    box=(92,66,932,906); r=190
    mask=mask_roundrect(box,r)
    shadow_from_mask(im,mask,(0,46),52,(8,16,38,110))
    bg=linear_gradient((S,S),top,bottom,(0.12,0.02),(0.88,0.98))
    paste_mask(im,bg,mask)
    shine=Image.new('RGBA',(S,S),(0,0,0,0))
    sd=ImageDraw.Draw(shine)
    sd.rounded_rectangle((106,80,918,420),radius=170,fill=(255,255,255,30))
    shine=shine.filter(ImageFilter.GaussianBlur(20))
    im.alpha_composite(Image.composite(shine,Image.new('RGBA',(S,S)),mask))
    d=ImageDraw.Draw(im)
    d.rounded_rectangle(box,radius=r,outline=(255,255,255,75),width=7)
    d.rounded_rectangle((99,73,925,899),radius=183,outline=(0,0,0,30),width=4)
    return im

def win_canvas():
    return Image.new('RGBA',(S,S),(0,0,0,0))

def add_roundrect(base, box, radius, fill, shadow=(0,28,32,(0,0,0,80)), outline=None, width=0):
    m=mask_roundrect(box,radius)
    if shadow:
        dx,dy,blur,col=shadow
        shadow_from_mask(base,m,(dx,dy),blur,col)
    paste_mask(base,fill,m)
    if outline:
        ImageDraw.Draw(base).rounded_rectangle(box,radius=radius,outline=outline,width=width or 5)
    return m

def add_ellipse(base, box, fill, shadow=None, outline=None, width=0):
    m=mask_ellipse(box)
    if shadow:
        dx,dy,blur,col=shadow
        shadow_from_mask(base,m,(dx,dy),blur,col)
    paste_mask(base,fill,m)
    if outline:
        ImageDraw.Draw(base).ellipse(box,outline=outline,width=width or 5)
    return m

def gear_points(cx,cy,outer,inner,teeth=10,angle=-math.pi/2):
    pts=[]
    for i in range(teeth*4):
        a=angle+i*math.pi/(teeth*2)
        phase=i%4
        r=outer if phase in (0,1) else inner
        pts.append((cx+math.cos(a)*r,cy+math.sin(a)*r))
    return pts

def mac_icon(name):
    palettes={
        'files':((88,181,255,255),(30,92,219,255)),
        'code':((132,92,255,255),(45,26,128,255)),
        'terminal':((69,76,92,255),(17,20,27,255)),
        'claude':((244,151,112,255),(174,78,56,255)),
        'studio':((255,183,84,255),(225,76,93,255)),
        'reel':((170,105,255,255),(86,42,196,255)),
        'viewer':((94,211,255,255),(24,102,214,255)),
        'store':((85,191,255,255),(63,82,226,255)),
        'create':((104,227,243,255),(83,62,231,255)),
        'monitor':((95,111,123,255),(25,30,38,255)),
        'assistant':((197,121,255,255),(75,43,202,255)),
        'settings':((204,216,231,255),(94,107,130,255)),
        'links':((135,182,255,255),(86,64,225,255)),
        'docs':((116,209,255,255),(28,94,207,255)),
    }
    im=mac_canvas(*palettes[name])
    d=ImageDraw.Draw(im)
    white=(250,252,255,255)
    if name=='files':
        add_roundrect(im,(205,315,820,720),85,linear_gradient((S,S),(104,206,255,255),(30,115,234,255),(0,0),(1,1)),(0,30,28,(0,26,87,70)),(255,255,255,70),5)
        d.rounded_rectangle((240,255,495,390),radius=55,fill=(154,225,255,255))
        d.polygon([(512,315),(820,315),(820,720),(512,720)],fill=(24,92,205,150))
        d.line((512,330,512,690),fill=(255,255,255,75),width=6)
        d.ellipse((330,445,360,485),fill=white)
        d.ellipse((645,445,675,485),fill=white)
        d.arc((340,495,680,640),start=12,end=168,fill=white,width=24)
    elif name=='code':
        add_roundrect(im,(190,230,835,750),78,(238,242,255,245),(0,34,34,(0,0,45,85)),(255,255,255,100),5)
        d.rounded_rectangle((190,230,835,345),radius=78,fill=(35,38,57,255))
        d.rectangle((190,300,835,345),fill=(35,38,57,255))
        for x,c in zip((250,305,360),((255,94,88,255),(255,190,55,255),(50,205,86,255))):
            d.ellipse((x,270,x+28,298),fill=c)
        draw_line(d,[(390,455),(310,520),(390,585)],(101,70,230,255),28)
        draw_line(d,[(635,455),(715,520),(635,585)],(101,70,230,255),28)
        draw_line(d,[(560,420),(470,625)],(235,83,163,255),24)
    elif name=='terminal':
        add_roundrect(im,(180,225,844,755),82,(27,30,38,255),(0,34,34,(0,0,0,100)),(255,255,255,65),5)
        d.rounded_rectangle((180,225,844,345),radius=82,fill=(54,58,70,255))
        d.rectangle((180,300,844,345),fill=(54,58,70,255))
        for x,c in zip((240,295,350),((255,94,88,255),(255,190,55,255),(50,205,86,255))):
            d.ellipse((x,266,x+28,294),fill=c)
        draw_line(d,[(305,470),(395,540),(305,610)],(99,235,164,255),28)
        d.rounded_rectangle((440,580,620,607),radius=13,fill=(238,243,248,255))
    elif name=='claude':
        add_ellipse(im,(250,190,775,715),linear_gradient((S,S),(255,190,151,255),(204,84,62,255),(0,0),(1,1)),(0,30,36,(73,20,6,80)),(255,255,255,80),6)
        for a in [0,math.pi/3,2*math.pi/3]:
            x1=512+math.cos(a)*115; y1=445+math.sin(a)*115
            x2=512-math.cos(a)*115; y2=445-math.sin(a)*115
            d.line((x1,y1,x2,y2),fill=white,width=36)
        d.ellipse((487,420,537,470),fill=white)
        add_roundrect(im,(485,585,790,765),52,(27,30,38,250),(0,18,20,(0,0,0,100)),(255,255,255,55),4)
        draw_line(d,[(550,640),(590,675),(550,710)],(255,172,122,255),16)
        d.rounded_rectangle((620,695,720,711),radius=8,fill=white)
    elif name=='studio':
        add_roundrect(im,(205,245,805,745),76,(252,248,245,250),(0,30,36,(72,18,40,80)),(255,255,255,110),6)
        d.rounded_rectangle((240,290,770,690),radius=52,fill=(255,184,108,255))
        d.ellipse((600,345,690,435),fill=(255,238,157,255))
        d.polygon([(240,635),(395,455),(520,575),(610,480),(770,650),(770,690),(240,690)],fill=(219,75,112,255))
        d.polygon([(240,650),(350,535),(455,640),(550,555),(690,690),(240,690)],fill=(104,70,219,210))
        draw_sparkle(d,760,255,70,white,0.25)
    elif name=='reel':
        add_roundrect(im,(205,295,810,735),75,(82,45,155,255),(0,30,34,(25,5,65,95)),(255,255,255,60),5)
        d.rounded_rectangle((235,220,790,400),radius=45,fill=(32,35,48,255))
        for x in (250,390,530,670):
            d.polygon([(x,220),(x+100,220),(x+45,400),(x-55,400)],fill=(245,246,250,255))
        d.rounded_rectangle((360,455,655,655),radius=52,fill=(159,83,244,255))
        d.polygon([(465,500),(465,610),(575,555)],fill=white)
    elif name=='viewer':
        add_roundrect(im,(205,250,770,720),72,(242,247,252,250),(0,30,34,(0,35,80,85)),(255,255,255,105),5)
        d.rounded_rectangle((240,285,735,675),radius=46,fill=(115,207,255,255))
        d.ellipse((580,340,665,425),fill=(255,231,117,255))
        d.polygon([(240,625),(380,455),(500,570),(585,490),(735,650),(735,675),(240,675)],fill=(45,123,221,255))
        d.ellipse((560,500,800,740),outline=(32,40,60,255),width=38)
        d.line((740,680,830,770),fill=(32,40,60,255),width=46)
        d.ellipse((586,526,774,714),outline=(255,255,255,155),width=8)
    elif name=='store':
        add_roundrect(im,(245,320,780,755),96,linear_gradient((S,S),(101,212,255,255),(67,72,222,255),(0,0),(1,1)),(0,34,38,(20,16,80,90)),(255,255,255,75),5)
        d.arc((350,175,675,470),start=190,end=350,fill=white,width=38)
        d.line((420,590,515,420),fill=white,width=38)
        d.line((515,420,615,590),fill=white,width=38)
        d.line((390,590,640,590),fill=white,width=38)
    elif name=='create':
        for box,col in [((220,250,445,475),(245,248,255,245)),((485,250,710,475),(221,232,255,245)),((220,510,445,735),(221,240,255,245)),((485,510,710,735),(245,248,255,245))]:
            add_roundrect(im,box,54,col,(0,20,22,(20,20,90,40)),(255,255,255,80),4)
        d.line((500,610,765,345),fill=(35,43,72,255),width=38)
        d.line((520,630,785,365),fill=white,width=18)
        draw_sparkle(d,790,320,95,white,0.23)
        draw_sparkle(d,330,355,52,(98,80,230,255),0.25)
    elif name=='monitor':
        add_roundrect(im,(205,220,820,745),92,(28,31,38,255),(0,38,42,(0,0,0,105)),(255,255,255,55),5)
        d.ellipse((285,290,740,700),fill=(20,25,31,255),outline=(140,156,168,255),width=18)
        for off in (0,60,120):
            d.arc((320+off//2,325+off//2,705-off//2,665-off//2),start=210,end=510,fill=(76,90,100,255),width=5)
        pts=[(315,545),(390,545),(430,455),(480,600),(535,390),(585,535),(705,535)]
        d.line(pts,fill=(104,238,123,255),width=25,joint='curve')
        for p in pts:
            d.ellipse((p[0]-13,p[1]-13,p[0]+13,p[1]+13),fill=(160,255,170,255))
    elif name=='assistant':
        add_ellipse(im,(215,205,785,775),radial_gradient((S,S),(231,188,255,255),(93,45,210,255),(0.4,0.3),0.65),(0,34,40,(36,6,87,95)),(255,255,255,70),6)
        draw_sparkle(d,500,475,150,white,0.23)
        draw_sparkle(d,710,315,65,(211,232,255,255),0.25)
        draw_sparkle(d,300,655,58,(236,208,255,255),0.25)
        d.ellipse((355,330,645,620),outline=(255,255,255,45),width=10)
    elif name=='settings':
        pts=gear_points(512,500,280,220,teeth=10)
        m=rounded_polygon_mask(pts)
        shadow_from_mask(im,m,(0,34),35,(20,30,55,95))
        paste_mask(im,linear_gradient((S,S),(247,250,253,255),(139,154,178,255),(0,0),(1,1)),m)
        d.polygon(pts,outline=(255,255,255,100))
        d.ellipse((350,338,674,662),fill=(83,99,126,255),outline=(255,255,255,80),width=8)
        d.ellipse((430,418,594,582),fill=(205,216,231,255))
    elif name=='links':
        def capsule_link(points,col,outline):
            d.line(points,fill=outline,width=150,joint='curve')
            d.line(points,fill=col,width=105,joint='curve')
        capsule_link([(310,590),(310,430),(430,310),(590,310)],(242,247,255,255),(47,62,111,160))
        capsule_link([(435,690),(595,690),(715,570),(715,410)],(222,232,255,255),(47,62,111,160))
        d.line((410,590,615,410),fill=(104,91,231,255),width=72)
        d.line((435,565,590,435),fill=white,width=26)
    elif name=='docs':
        add_roundrect(im,(265,205,720,760),56,(247,250,255,255),(0,32,36,(0,36,90,80)),(255,255,255,100),5)
        d.polygon([(575,205),(720,350),(575,350)],fill=(190,220,250,255))
        d.line((575,205,575,350,720,350),fill=(130,180,235,255),width=5)
        for y,w in ((440,300),(510,330),(580,270),(650,320)):
            d.rounded_rectangle((330,y,330+w,y+24),radius=12,fill=(67,122,220,220))
        add_roundrect(im,(185,550,395,765),54,(51,117,230,255),(0,18,22,(0,30,80,90)),(255,255,255,70),4)
        d.line((240,655,280,695,345,610),fill=white,width=25,joint='curve')
    return im

def win_icon(name):
    im=win_canvas()
    d=ImageDraw.Draw(im)
    white=(250,252,255,255)
    def grad(c1,c2): return linear_gradient((S,S),c1,c2,(0.1,0.05),(0.9,0.95))
    if name=='files':
        back_pts=[(175,330),(420,330),(485,245),(800,245),(850,330),(850,730),(175,730)]
        m=rounded_polygon_mask(back_pts); shadow_from_mask(im,m,(0,35),35,(28,35,45,90))
        d.polygon(back_pts,fill=(253,190,55,255))
        d.rounded_rectangle((175,360,850,735),radius=65,fill=(255,206,76,255),outline=(255,232,141,255),width=8)
        d.rounded_rectangle((210,395,815,470),radius=30,fill=(255,221,106,255))
        d.rounded_rectangle((525,320,770,620),radius=38,fill=(74,151,245,255))
        d.polygon([(680,320),(770,410),(680,410)],fill=(153,204,255,255))
    elif name=='code':
        add_roundrect(im,(230,260,775,730),58,grad((64,108,241,255),(117,69,225,255)),(0,36,38,(30,20,80,90)),(255,255,255,60),5)
        d.line((410,400,300,495,410,590),fill=white,width=34,joint='curve')
        d.line((595,400,705,495,595,590),fill=white,width=34,joint='curve')
        d.line((555,350,455,640),fill=(216,225,255,255),width=28)
    elif name=='terminal':
        add_roundrect(im,(185,255,835,730),58,(29,35,48,255),(0,38,40,(0,0,0,110)),(95,111,137,255),6)
        d.rounded_rectangle((185,255,835,350),radius=58,fill=(58,73,104,255))
        d.rectangle((185,315,835,350),fill=(58,73,104,255))
        d.line((300,450,385,525,300,600),fill=(70,167,255,255),width=30,joint='curve')
        d.rounded_rectangle((430,590,620,615),radius=12,fill=white)
    elif name=='claude':
        add_ellipse(im,(255,215,755,715),grad((247,167,126,255),(194,75,55,255)),(0,35,40,(60,20,10,90)),(255,255,255,45),5)
        for a in [0,math.pi/3,2*math.pi/3]:
            d.line((512+math.cos(a)*115,465+math.sin(a)*115,512-math.cos(a)*115,465-math.sin(a)*115),fill=white,width=34)
        add_roundrect(im,(445,585,790,745),42,(30,36,49,255),(0,20,22,(0,0,0,80)),None)
        d.line((505,625,550,665,505,705),fill=(255,151,112,255),width=16)
        d.rounded_rectangle((585,690,705,706),radius=8,fill=white)
    elif name=='studio':
        add_roundrect(im,(200,250,800,735),58,(245,248,252,255),(0,36,38,(30,45,65,80)),(180,193,210,255),5)
        d.rounded_rectangle((235,285,765,700),radius=36,fill=(79,170,248,255))
        d.ellipse((610,335,690,415),fill=(255,221,101,255))
        d.polygon([(235,650),(385,455),(515,585),(610,505),(765,670),(765,700),(235,700)],fill=(78,100,219,255))
        d.polygon([(235,670),(345,550),(445,650),(525,575),(680,700),(235,700)],fill=(99,205,178,255))
    elif name=='reel':
        add_roundrect(im,(205,315,810,735),58,grad((112,70,218,255),(68,38,150,255)),(0,36,38,(32,15,75,90)),(255,255,255,45),5)
        d.rounded_rectangle((225,220,790,390),radius=30,fill=(41,48,65,255))
        for x in (245,390,535,680):
            d.polygon([(x,220),(x+95,220),(x+45,390),(x-50,390)],fill=(238,241,247,255))
        d.polygon([(450,470),(450,625),(605,548)],fill=white)
    elif name=='viewer':
        add_roundrect(im,(195,255,745,715),58,(245,248,252,255),(0,36,38,(30,45,65,80)),(175,190,208,255),5)
        d.rounded_rectangle((225,285,715,685),radius=36,fill=(96,190,250,255))
        d.ellipse((575,335,655,415),fill=(255,220,94,255))
        d.polygon([(225,640),(365,475),(480,580),(565,505),(715,660),(715,685),(225,685)],fill=(47,111,211,255))
        d.ellipse((540,500,790,750),outline=(55,69,91,255),width=36)
        d.line((730,690,835,790),fill=(55,69,91,255),width=44)
    elif name=='store':
        add_roundrect(im,(245,330,785,750),64,grad((67,168,255,255),(45,103,220,255)),(0,36,38,(25,45,90,90)),(255,255,255,45),5)
        d.arc((355,185,675,480),start=190,end=350,fill=white,width=34)
        for bx,by in ((390,470),(520,470),(390,600),(520,600)):
            d.rounded_rectangle((bx,by,bx+100,by+100),radius=10,fill=white)
    elif name=='create':
        add_roundrect(im,(245,300,675,730),68,grad((78,164,255,255),(103,73,225,255)),(0,36,38,(35,25,90,90)),(255,255,255,55),5)
        d.line((410,650,735,325),fill=(45,54,77,255),width=48)
        d.line((430,670,755,345),fill=white,width=20)
        draw_sparkle(d,770,300,100,(90,194,255,255),0.22)
        draw_sparkle(d,265,255,55,(150,113,245,255),0.25)
    elif name=='monitor':
        add_roundrect(im,(185,250,840,700),58,(34,41,55,255),(0,38,42,(0,0,0,110)),(92,108,132,255),6)
        for y in (360,455,550):
            d.line((235,y,790,y),fill=(74,88,110,255),width=4)
        pts=[(235,585),(325,585),(380,465),(445,620),(520,390),(600,545),(790,545)]
        d.line(pts,fill=(86,221,126,255),width=22,joint='curve')
        d.rounded_rectangle((455,700,570,790),radius=22,fill=(89,105,128,255))
        d.rounded_rectangle((355,775,670,815),radius=20,fill=(120,135,158,255))
    elif name=='assistant':
        add_ellipse(im,(230,205,790,765),radial_gradient((S,S),(217,194,255,255),(78,60,217,255),(0.4,0.3),0.68),(0,38,42,(35,20,90,100)),(255,255,255,50),5)
        draw_sparkle(d,500,485,145,white,0.22)
        draw_sparkle(d,720,320,62,(128,210,255,255),0.25)
        draw_sparkle(d,300,675,54,(196,171,255,255),0.25)
    elif name=='settings':
        pts=gear_points(512,500,285,215,teeth=10)
        m=rounded_polygon_mask(pts); shadow_from_mask(im,m,(0,38),38,(22,30,45,100))
        paste_mask(im,grad((205,216,230,255),(109,125,151,255)),m)
        d.ellipse((350,338,674,662),fill=(66,105,178,255))
        d.ellipse((435,423,589,577),fill=(220,230,241,255))
    elif name=='links':
        d.line([(310,600),(310,430),(440,300),(600,300)],fill=(43,96,203,255),width=145,joint='curve')
        d.line([(310,600),(310,430),(440,300),(600,300)],fill=(142,197,255,255),width=88,joint='curve')
        d.line([(420,705),(585,705),(720,570),(720,405)],fill=(72,65,201,255),width=145,joint='curve')
        d.line([(420,705),(585,705),(720,570),(720,405)],fill=(177,170,255,255),width=88,joint='curve')
        d.line((430,585,610,405),fill=white,width=24)
    elif name=='docs':
        add_roundrect(im,(270,210,735,765),42,(247,250,253,255),(0,36,38,(28,40,65,85)),(180,194,210,255),5)
        d.polygon([(580,210),(735,365),(580,365)],fill=(173,216,255,255))
        d.line((580,210,580,365,735,365),fill=(101,164,230,255),width=5)
        for y,w in ((450,300),(520,335),(590,270),(660,315)):
            d.rounded_rectangle((335,y,335+w,y+22),radius=11,fill=(54,121,225,220))
        add_roundrect(im,(185,560,405,780),44,grad((62,158,255,255),(38,99,215,255)),(0,20,24,(10,35,85,85)),None)
        for bx,by in ((235,610),(305,610),(235,680),(305,680)):
            d.rectangle((bx,by,bx+52,by+52),fill=white)
    return im

def mac_special(name):
    if name=='launchpad':
        im=mac_canvas((91,105,132,255),(28,34,51,255))
        d=ImageDraw.Draw(im)
        cols=[(76,170,255,255),(245,102,143,255),(255,184,63,255),(86,216,157,255),(135,90,239,255),(71,120,229,255),(255,121,82,255),(175,196,221,255),(102,219,237,255)]
        xs=[270,420,570]; ys=[270,420,570]
        for i,(y,x) in enumerate([(y,x) for y in ys for x in xs]):
            d.rounded_rectangle((x,y,x+110,y+110),radius=28,fill=cols[i],outline=(255,255,255,60),width=4)
            d.rounded_rectangle((x+12,y+12,x+98,y+42),radius=18,fill=(255,255,255,30))
        return im
    if name=='mission-control':
        im=mac_canvas((94,108,138,255),(29,35,53,255))
        d=ImageDraw.Draw(im)
        for box,col,top in [((220,280,620,570),(63,76,104,255),(93,109,145,255)),((400,230,805,530),(58,70,98,255),(104,119,154,255)),((300,430,730,735),(42,50,70,255),(92,109,145,255))]:
            add_roundrect(im,box,48,col,(0,20,24,(0,0,0,80)),(255,255,255,55),4)
            x0,y0,x1,y1=box
            d.rounded_rectangle((x0,y0,x1,y0+72),radius=48,fill=top)
            d.rectangle((x0,y0+38,x1,y0+72),fill=top)
            for i,c in enumerate(((255,95,89,255),(255,190,55,255),(52,204,85,255))):
                d.ellipse((x0+30+i*44,y0+22,x0+50+i*44,y0+42),fill=c)
        d.rounded_rectangle((355,515,675,675),radius=24,fill=(91,112,168,255))
        d.line((390,565,635,565),fill=(180,202,255,180),width=14)
        d.line((390,615,580,615),fill=(180,202,255,150),width=14)
        return im

NAMES = ['files','code','terminal','claude','studio','reel','viewer','store','create','monitor','assistant','settings','links','docs']
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'app-icons'
PREVIEW = Path('/tmp/mso-platform-icon-preview')

def save_webp(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    final = image.resize((256, 256), Image.Resampling.LANCZOS)
    final.save(path, 'WEBP', quality=92, alpha_quality=100, method=6, exact=True)

def make_preview(platform, files):
    cell = 300
    cols = 7
    rows = math.ceil(len(files) / cols)
    bg = (232, 236, 244, 255) if platform == 'macos' else (247, 249, 252, 255)
    sheet = Image.new('RGBA', (cols * cell, rows * cell), bg)
    draw = ImageDraw.Draw(sheet)
    for index, path in enumerate(files):
        icon = Image.open(path).convert('RGBA')
        x = (index % cols) * cell + 22
        y = (index // cols) * cell + 8
        sheet.alpha_composite(icon, (x, y))
        draw.text(((index % cols) * cell + 12, (index // cols) * cell + 268), path.stem, fill=(24, 30, 42, 255))
    PREVIEW.mkdir(parents=True, exist_ok=True)
    sheet.convert('RGB').save(PREVIEW / f'{platform}.jpg', quality=92)

def main():
    generated = {'macos': [], 'windows': []}
    for platform, maker in (('macos', mac_icon), ('windows', win_icon)):
        for name in NAMES:
            path = OUT / platform / f'{name}.webp'
            save_webp(maker(name), path)
            generated[platform].append(path)
    for name in ('launchpad', 'mission-control'):
        path = OUT / f'{name}.webp'
        save_webp(mac_special(name), path)
        generated['macos'].append(path)
    for platform, files in generated.items():
        make_preview(platform, files)
    for platform, files in generated.items():
        print(f'{platform}: {len(files)} icons')
        for path in files:
            image = Image.open(path)
            corner = image.convert('RGBA').getpixel((0, 0))
            print(f'  {path.relative_to(ROOT)} {image.size} {image.mode} corner={corner}')
    print(f'preview: {PREVIEW}')

if __name__ == '__main__':
    main()
