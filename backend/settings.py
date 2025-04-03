import os
import typing as tp
import urllib.request

from base.backend import app
from base.backend.app import get_models_path, path_to_main_module
from base.backend.settings import Settings as BaseSettings


class Settings(BaseSettings):
    def get_defaults(self):
        d = super().get_defaults()
        d.update({
            'cells_enabled'     : True,
            'treerings_enabled' : True,
            'ignore_buffer_px'  : 8,
            'micrometer_factor' : 1.5,
        })
        return d
    
    #override
    @classmethod
    def get_available_models(cls, *a, **kw) -> tp.Dict[str, tp.List]:
        downloaded_models = super().get_available_models(*a, **kw)
        downloaded_modelnames = [
            info_or_name if isinstance(info_or_name, str) else info_or_name['name'] 
                for _, modelslist in downloaded_models.items() 
                    for info_or_name in modelslist
        ]
        all_models = dict(downloaded_models)
        additional_models = parse_pretrained_models_file()
        for modelpath, modelurl in additional_models.items():
            modelname = os.path.basename(modelpath)
            modelname = modelname.replace('.pt.zip', '').replace('.pt', '')
            if modelname in downloaded_modelnames:
                continue
            modeltype = os.path.dirname(modelpath)
            all_models[modeltype] = all_models.get(modeltype, []) + [{
                'name': modelname,
                'url':  modelurl,
                'path': modelpath,
                'properties': None,
            }]
        return all_models

    @classmethod
    def load_model(cls, modeltype:str, modelname:str):
        print(f'Loading model {modeltype}/{modelname}')
        models_dir = app.get_models_path()
        additional_models = parse_pretrained_models_file()
        endings    = ['.pt.zip', '.pt']
        for ending in endings:
            relpath = os.path.join(modeltype, f'{modelname}{ending}')
            abspath = os.path.join(models_dir, relpath)
            if not os.path.exists(abspath) and relpath in additional_models:
                download_file(additional_models[relpath], abspath)
            
            if os.path.exists(abspath):
                return cls.load_modelfile(abspath)
        #no file with either of the endings exists
        print(f'[ERROR] model "{modeltype}/{modelname}" not found.')
        return



#TODO: replace path_to_main_module with models_path (need to fix tests)
DEFAULT_PRETRAINED_FILE = os.path.join(path_to_main_module(), 'models', 'pretrained_models.txt')

def parse_pretrained_models_file(path=DEFAULT_PRETRAINED_FILE) -> tp.Dict[str,str]:
    lines         = open(path).read().strip().split('\n')
    name2urls     = dict([ map(str.strip, line.split(' : ')) for line in lines])
    return name2urls

def ensure_pretrained_models() -> None:
    models_path = get_models_path()
    for destination, url in parse_pretrained_models_file().items():
        destination = os.path.join(models_path, destination)
        if os.path.exists(destination):
            continue
        download_file(url, destination)


def download_file(url:str, destination:str):
    print(f'Downloading {url} ...')
    with urllib.request.urlopen(url) as f:
        os.makedirs( os.path.dirname(destination), exist_ok=True )
        open(destination, 'wb').write(f.read())
