"""Discover all indexed hk4e versions, confirm against the official build API."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
import re
import ssl
import threading
import time
from urllib import request

from services.history import query_build, version_tuple

INDEX_URL = 'https://raw.githubusercontent.com/orilights/pkg_version/main/hk4e_versions.json'
CACHE_SECONDS = 600
_cache = {}
_lock = threading.Lock()


def indexed_versions():
    with request.urlopen(INDEX_URL, timeout=30, context=ssl.create_default_context()) as response:
        data = json.load(response)
    if not isinstance(data, dict):raise ValueError('Invalid historical version index')
    versions = {tag for tag in data if re.fullmatch(r'\d+\.\d+\.\d+', tag)}
    if not versions:raise ValueError('Historical version index is empty')
    return versions


def build_sizes(build):
    def amount(stats,key):
        try:
            value=int(stats[key])
            return value if value>=0 else None
        except (KeyError,TypeError,ValueError):return None
    return {item.get('matching_field'):{
        'total_size':amount(item.get('stats') or {},'uncompressed_size'),
        'download_size':amount(item.get('stats') or {},'compressed_size')}
        for item in build.get('manifests',[]) if item.get('matching_field')}


def available_versions(region, refresh=False):
    if region not in {'cn','os','bb'}:raise ValueError('Unsupported region')
    # Coalesce repeated requests and bound official API load. Memory cache only.
    with _lock:
        now=time.monotonic()
        cached=_cache.get(region)
        if cached and not refresh and now-cached[0]<CACHE_SECONDS:
            value=deepcopy(cached[1]);value['cached']=True;return value
        candidates=indexed_versions()
        latest=query_build(region)['data']
        candidates.add(latest['tag'])
        available={latest['tag']}
        errors=[]
        sizes={latest['tag']:build_sizes(latest)}
        def check(tag):
            try:
                build=query_build(region,tag)['data']
                if build['tag']!=tag or not build.get('manifests'):
                    return tag,False,{},'Official build returned an invalid version or no manifests'
                return tag,True,build_sizes(build),None
            except ValueError as exc:
                # Only a recognized not-found response means unavailable.
                message=str(exc)
                if 'not found' in message.lower() or message.startswith('No downloadable manifests'):
                    return tag,False,{},None
                return tag,False,{},message
            except Exception as exc:
                return tag,False,{},str(exc)
        with ThreadPoolExecutor(max_workers=4) as pool:
            for tag,ok,details,error in pool.map(check,sorted(candidates-{latest['tag']},key=version_tuple)):
                if ok:
                    available.add(tag)
                    sizes[tag]=details
                if error:errors.append({'version':tag,'error':error})
        value={'region':region,'package':'hk4e_'+region,'versions':sorted(available,key=version_tuple,reverse=True),
               'version_sizes':sizes,'size_source':'official_manifest_stats',
               'latest':latest['tag'],'candidate_count':len(candidates),'errors':errors,
               'source':INDEX_URL,'coverage':'indexed_history_and_current_latest',
               'complete':False,'verification':'official_build_manifest_available',
               'cached':False,'cache_seconds':CACHE_SECONDS}
        # Failed probes are never cached as a definitive catalog.
        if not errors:_cache[region]=(time.monotonic(),deepcopy(value))
        return value
