"""HTMLParser ve dosya sınırlarıyla bağımsız kabuk kontrolü; ek paket yok."""
from html.parser import HTMLParser
from pathlib import Path
import sys

class Shell(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.errors=[]; self.stack=[]; self.raw=False; self.count=0
    def handle_starttag(self, tag, attrs):
        self.count+=1
        names=[k for k,_ in attrs]
        if len(set(names))!=len(names): self.errors.append('Yinelenen HTML attribute: '+tag)
        if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}: self.stack.append(tag)
    def handle_startendtag(self,tag,attrs):
        self.count+=1
    def handle_endtag(self,tag):
        if not self.stack or self.stack[-1]!=tag: self.errors.append('Eşleşmeyen HTML kapanışı: '+tag)
        else: self.stack.pop()

root=Path(sys.argv[1] if len(sys.argv)>1 else Path(__file__).resolve().parents[2]).resolve()
parser=Shell();parser.feed((root/'index.html').read_text(encoding='utf-8'));parser.close()
if parser.stack:parser.errors.append('Kapanmayan HTML etiketleri: '+str(parser.stack))
for error in parser.errors:print(error,file=sys.stderr)
print(f'{parser.count} HTML etiketi; {len(parser.errors)} hata')
sys.exit(bool(parser.errors))
