"""Gesture rules over MediaPipe image landmarks. No camera or network access."""
import math

def distance(a, b):
    return math.hypot(a['x'] - b['x'], a['y'] - b['y'])

def extended(points, tip):
    a, b, c = points[tip-2], points[tip-1], points[tip]
    v = (a['x']-b['x'], a['y']-b['y'])
    w = (c['x']-b['x'], c['y']-b['y'])
    denominator = math.hypot(*v)*math.hypot(*w)
    return denominator > .00001 and (v[0]*w[0]+v[1]*w[1])/denominator < -.7 and distance(c,points[0]) > distance(a,points[0])*1.12

class Detector:
    def __init__(self):
        self.candidate = None
        self.since = 0
        self.locked = False
        self.neutral_since = None
        self.cooldown = 0
        self.fist = None
        self.fist_since = None
        self.fist_cracked = False

    def update(self, result, now):
        hands = result.get('landmarks', [])
        if not isinstance(hands,list) or len(hands)>2:
            return None
        hands = [p for p in hands if isinstance(p,list) and len(p)==21 and all(isinstance(q,dict) and all(isinstance(q.get(k),(float,int)) and math.isfinite(q[k]) for k in ('x','y')) for q in p)]
        candidates = []
        gestures = result.get('gestures', [])
        held_fist = False
        for index, p in enumerate(hands):
            shape = {t:extended(p,t) for t in (8,12,16,20)}
            if shape[12] and not any(shape[t] for t in (8,16,20)):
                candidates.append('explode')
            category = gestures[index][0] if index<len(gestures) and gestures[index] else {}
            label = category.get('categoryName','') if category.get('score',0)>=.6 else ''
            if label=='Thumb_Down':
                candidates.append('melt')
            if label=='Closed_Fist' and len(hands)==1:
                held_fist = True
                size = distance(p[0],p[9])
                center = ((p[0]['x']+p[9]['x'])/2,(p[0]['y']+p[9]['y'])/2)
                if self.fist is None:
                    self.fist = (now,size,center)
                else:
                    at, baseline, previous = self.fist
                    elapsed = now-at
                    if .08<elapsed<.65 and baseline>.015 and size>baseline*1.28:
                        candidates.append('punch')
                    elif elapsed>.65:
                        self.fist=(now,size,center)
            else:
                self.fist=None
        if held_fist:
            if self.fist_since is None:self.fist_since=now
        else:
            self.fist=None;self.fist_since=None;self.fist_cracked=False
        if len(hands)==2:
            a,b = hands
            scale=(distance(a[0],a[9])+distance(b[0],b[9]))/2
            # Chest-level two-hand finger silhouette, not ILoveYou or a single-hand heart.
            if scale>.015 and distance(a[8],b[8])<scale*.65 and distance(a[4],b[4])<scale*.65 and (a[4]['y']+b[4]['y'])/2-(a[8]['y']+b[8]['y'])/2>scale*.3 and distance(a[0],b[0])>scale*1.1 and not extended(a,8) and not extended(b,8):
                candidates.append('heart')
        effect = candidates[0] if len(candidates)==1 else None
        # A held fist is not neutral: a punch cannot repeat before releasing it.
        neutral = not candidates and self.fist is None
        if neutral:
            if self.neutral_since is None:self.neutral_since=now
            if now-self.neutral_since>.25:self.locked=False
        else:self.neutral_since=None
        if effect!=self.candidate:
            self.candidate=effect; self.since=now
        if effect and not self.locked and now>=self.cooldown and (effect=='punch' or now-self.since>=.3):
            self.locked=True;self.cooldown=now+1.1
            if effect=='punch':self.fist_cracked=True
            return effect
        # Closing a fist chips the text once, without locking out its forward punch.
        if effect is None and held_fist and not self.locked and not self.fist_cracked and now-self.fist_since>=.3:
            self.fist_cracked=True
            return 'crack'
        return None
