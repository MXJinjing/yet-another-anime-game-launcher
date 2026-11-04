"""Validated manifest cache and indexed directory browsing, independent of downloader OPT."""
from collections import OrderedDict
from pathlib import Path, PurePosixPath
import fnmatch
import hashlib
import os
import threading
import time
from urllib import request
import zstandard
import manifest_pb2
from services.history import query_build

_lock = threading.RLock()
_cache = OrderedDict()
CACHE_SECONDS = 900
MAX_MANIFESTS = 4


def parse_manifest(raw, expected_size=0):
    if expected_size and len(raw) != expected_size:
        raise ValueError(f'Incomplete manifest: {len(raw)} / {expected_size} bytes')
    decompressor = zstandard.ZstdDecompressor().decompressobj()
    decoded = decompressor.decompress(raw)
    if not decompressor.eof: raise ValueError('Incomplete zstd manifest frame')
    manifest = manifest_pb2.Manifest()
    manifest.ParseFromString(decoded)
    if not manifest.files: raise ValueError('Manifest contains no files')
    return manifest


def fetch_manifest(url, expected_size=0):
    last = None
    for attempt in range(3):
        try:
            with request.urlopen(url, timeout=60) as response:
                raw = response.read()
                length = int(response.headers.get('Content-Length') or 0)
            return raw, parse_manifest(raw, expected_size or length)
        except Exception as exc:
            last = exc
            if attempt < 2: time.sleep(.5 * (attempt + 1))
    raise RuntimeError(f'Manifest download failed after 3 attempts: {last}') from last


class DirectoryIndex:
    def __init__(self, manifest):
        self.entries = {}
        self.children = {'': {}}
        self.filters = OrderedDict()
        for item in manifest.files:
            path = item.filename.rstrip('/')
            parts = PurePosixPath(path).parts
            if not parts or path.startswith('/') or '\\' in path or ':' in path or '..' in parts:
                raise ValueError('Unsafe manifest path: '+path)
            for depth in range(1, len(parts)):
                parent='/'.join(parts[:depth])
                self.entries.setdefault(parent,{'filename':parent,'name':parts[depth-1],'type':'directory','size':None,'md5':None})
            self.entries[path]={'filename':path,'name':parts[-1],'type':'directory' if item.flags==64 else 'file','size':None if item.flags==64 else item.size,'md5':None if item.flags==64 else item.md5}
        for path, entry in self.entries.items():
            parent=path.rpartition('/')[0]
            self.children.setdefault(parent,{})[path]=entry
            if entry['type']=='directory': self.children.setdefault(path,{})
        self.children={path:tuple(sorted(items.values(),key=lambda item:(item['type']!='directory',item['name']))) for path,items in self.children.items()}
        self.all_files=tuple(sorted((entry for entry in self.entries.values() if entry['type']=='file'),key=lambda entry:entry['filename']))

    def listing(self,path='.',pattern=None,recursive=False,offset=0,limit=100):
        path=path.strip('/') if path in {'','.'} else path.rstrip('/')
        if path=='.':path=''
        if path.startswith('/') or '\\' in path or ':' in path or '..' in PurePosixPath(path).parts:
            raise ValueError('Use a relative manifest path without ..')
        if path and path not in self.entries:raise FileNotFoundError('Manifest path not found: '+path)
        if path and self.entries[path]['type']=='file':items=(self.entries[path],)
        elif pattern is None and not recursive:items=self.children.get(path,())
        else:
            key=(path,pattern,recursive)
            if key not in self.filters:
                prefix=path+'/' if path else ''
                base=self.all_files if recursive or pattern is not None else self.children.get(path,())
                self.filters[key]=tuple(entry for entry in base if entry['filename'].startswith(prefix) and (pattern is None or fnmatch.fnmatchcase(entry['filename'],pattern)))
                if len(self.filters)>16:self.filters.popitem(last=False)
            items=self.filters[key]
        return {'path':path or '.', 'total':len(items),'offset':offset,'files':list(items[offset:offset+limit])}


def manifest_index(region,version,category,refresh=False):
    key=(region,version,category)
    with _lock:
        cached=_cache.get(key)
        if cached and not refresh and time.monotonic()-cached[0]<CACHE_SECONDS:
            _cache.move_to_end(key);return cached[1],True
        build=query_build(region,version)['data']
        matching=[item for item in build['manifests'] if item['matching_field']==category]
        if len(matching)!=1:raise ValueError('Category not found: '+category)
        meta=matching[0];url=meta['manifest_download']['url_prefix'].rstrip('/')+'/'+meta['manifest']['id']
        expected=int(meta['manifest'].get('compressed_size') or 0)
        directory=Path(os.environ.get('SOPHON_MANIFEST_CACHE',str(Path.home()/'.cache/sophon-server/manifests'))).expanduser()
        directory.mkdir(parents=True,exist_ok=True)
        file=directory/(hashlib.sha256(url.encode()).hexdigest()+'.zstd')
        manifest=None
        if file.is_file() and not refresh:
            try:manifest=parse_manifest(file.read_bytes(),expected)
            except Exception:file.unlink(missing_ok=True)
        if manifest is None:
            raw,manifest=fetch_manifest(url,expected)
            import tempfile
            with tempfile.NamedTemporaryFile(dir=directory,prefix='.partial-',delete=False) as stream:
                temp=Path(stream.name);stream.write(raw)
            try:temp.replace(file)
            finally:temp.unlink(missing_ok=True)
        index=DirectoryIndex(manifest)
        _cache[key]=(time.monotonic(),index);_cache.move_to_end(key)
        while len(_cache)>MAX_MANIFESTS:_cache.popitem(last=False)
        return index,False


def browse_files(region,version,category,path='.',pattern=None,offset=0,limit=100,recursive=False,refresh=False):
    with _lock:
        index,cached=manifest_index(region,version,category,refresh)
        return {'version':version,'region':region,'category':category,'cached':cached,
                **index.listing(path,pattern,recursive,offset,limit)}
