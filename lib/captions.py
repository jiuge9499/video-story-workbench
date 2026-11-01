"""Build readable phrases from authored text and monotonic speech word timings."""
import re

CLOSE = '”’」』》）)】]"\''
OPEN = '“‘「『《（(【['
PUNCT = re.compile(r'[，。！？；：、,.!?;:][”’」』》）)】\]"\']*$')
STRONG = re.compile(r'[。！？.!?][”’」』》）)】\]"\']*$')


def visible_length(text):
    return len(re.sub(r'[\s，。！？；：、,.!?;:“”‘’「」『』《》（）()【】\[\]"\']', '', text))


def timed_units(source, words):
    """Attach opening quotes forward, closing quotes and punctuation backward."""
    open_positions, quotes = set(), set()
    for i, char in enumerate(source):
        if char in OPEN:
            open_positions.add(i)
        elif char in '\"\'':
            if char == "'" and i and i+1 < len(source) and source[i-1].isalnum() and source[i+1].isalnum():
                continue
            if char in quotes:
                quotes.remove(char)
            else:
                quotes.add(char)
                open_positions.add(i)
    matches, cursor = [], 0
    for word in words:
        token = word['text'].strip()
        if not token:
            continue
        index = source.lower().find(token.lower(), cursor)
        if index < 0:
            raise ValueError('配音词时间与原文无法对齐：'+token)
        matches.append((index, index+len(token), word))
        cursor = index+len(token)
    if not matches:
        raise ValueError('未收到配音词时间')
    starts = [0]
    for previous, current in zip(matches, matches[1:]):
        split = current[0]
        while split > previous[1] and (split-1 in open_positions or source[split-1].isspace()):
            split -= 1
        starts.append(split)
    starts.append(len(source))
    return [dict(start=m[2]['start'], end=m[2]['end'], text=source[starts[i]:starts[i+1]])
            for i, m in enumerate(matches)]


def split_long_phrase(units):
    """Balance long clauses at whole-word boundaries; penalize dangling particles."""
    text = ''.join(u['text'] for u in units)
    if visible_length(text) <= 22 and units[-1]['end']-units[0]['start'] <= 4.5:
        return [units]
    n = len(units)
    best, previous = [float('inf')]*(n+1), [None]*(n+1)
    best[0] = 0
    for end in range(1, n+1):
        for start in range(end-1, -1, -1):
            part = ''.join(u['text'] for u in units[start:end])
            length = visible_length(part)
            if length > 22 and end-start > 1:
                break
            duration = units[end-1]['end']-units[start]['start']
            cost = 22 + .22*(length-14)**2 + 8*max(0, 6-length)**2
            cost += 70*max(0, .9-duration)**2 + 25*max(0, duration-4.5)**2
            if end < n:
                left = part.rstrip()
                right = ''.join(u['text'] for u in units[end:]).lstrip()
                if re.search(r'[的地得把被让给和与或及就才再更很在要会能将]$', left):
                    cost += 90
                if re.match(r'[的地得了着过吗呢吧啊，。！？；：、]', right):
                    cost += 90
                if re.match(r'(不如|然后|但是|因为|所以|而且|可是|反而|等于|才能|先|再|让|是给)', right):
                    cost -= 16
                gap = max(0, units[end]['start']-units[end-1]['end'])
                cost -= min(12, gap*40)
            if best[start]+cost < best[end]:
                best[end], previous[end] = best[start]+cost, start
    result, end = [], n
    while end:
        start = previous[end]
        result.append(units[start:end])
        end = start
    return result[::-1]


def phrase_captions(source, words):
    units = timed_units(source, words)
    clauses, current = [], []
    for unit in units:
        current.append(unit)
        text = unit['text'].rstrip()
        # A quoted question is one phrase even when its punctuation was omitted.
        if PUNCT.search(text) or (text and text[-1] in CLOSE):
            clauses.append(current)
            current = []
    if current:
        clauses.append(current)
    merged, i = [], 0
    while i < len(clauses):
        clause = clauses[i]
        text = ''.join(u['text'] for u in clause)
        if (i+1 < len(clauses) and visible_length(text) <= 5
                and clause[-1]['end']-clause[0]['start'] < .9 and not STRONG.search(text)
                and visible_length(text+''.join(u['text'] for u in clauses[i+1])) <= 22):
            clause = clause+clauses[i+1]
            i += 1
        merged.extend(split_long_phrase(clause))
        i += 1
    return [dict(start=group[0]['start'], end=group[-1]['end'],
                 text=''.join(u['text'] for u in group).strip()) for group in merged]
