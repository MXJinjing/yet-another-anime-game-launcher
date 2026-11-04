"""Read installation status on the server filesystem without modifying it."""
import configparser
import json
from pathlib import Path
from services.history import version_tuple


def directory_status(directory):
    root=Path(directory).expanduser().resolve()
    if root == Path(root.anchor) or root == Path.home().resolve():raise ValueError('Use a dedicated game directory')
    if root.exists() and not root.is_dir():raise ValueError('Not a directory')
    result={'directory':str(root),'status':'not_installed','version':None,
            'pending_version':None,'package':None,'region':None,'integrity':'not_checked'}
    if not root.is_dir():
        result['status']='directory_missing'
        return result
    cfg=configparser.ConfigParser(interpolation=None)
    try:
        cfg.read(root/'config.ini',encoding='utf-8-sig')
        version=cfg.get('General','game_version',fallback=None)
        if version:version_tuple(version)
        result['version']=version
        channel=cfg.get('General','channel',fallback=None)
        sub_channel=cfg.get('General','sub_channel',fallback=None)
        region='bb' if channel=='14' else ({'1':'cn','0':'os'}.get(sub_channel) if channel=='1' else None)
        if region:
            result['region']=region
            result['package']='hk4e_'+region
        state_path=root/'.sophon/state.json'
        if state_path.is_file():
            state=json.loads(state_path.read_text(encoding='utf-8'))
            if state.get('schema')!=1 or state.get('game_type')!='hk4e':
                raise ValueError('不支持的服务端目录状态格式')
            region=state.get('region')
            if region not in {'cn','os','bb'}:raise ValueError('无效地区')
            result['region']=region
            result['package']='hk4e_'+region
            result['pending_version']=state.get('pending_version')
            if result['pending_version']:version_tuple(result['pending_version'])
            result['server_version']=state.get('version')
            result['categories']=state.get('categories',[])
            if result['pending_version']:
                result['status']='update_pending' if version else 'install_pending'
            elif version and state.get('version')!=version:
                result['status']='version_mismatch'
            elif version:result['status']='installed'
        elif version:result['status']='installed'
        return result
    except (configparser.Error,UnicodeError,ValueError,AttributeError) as exc:
        raise ValueError(f'无法读取安装信息：{exc}') from exc
