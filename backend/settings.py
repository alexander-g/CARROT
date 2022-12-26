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




import urllib.request, os
from base.backend.app import get_models_path, path_to_main_module

#TODO: replace path_to_main_module with models_path (need to fix tests)
DEFAULT_PRETRAINED_FILE = os.path.join(path_to_main_module(), 'models', 'pretrained_models.txt')

def parse_pretrained_models_file(path=DEFAULT_PRETRAINED_FILE) -> dict:
    lines         = open(path).read().strip().split('\n')
    name2urls     = dict([ map(str.strip, line.split(' : ')) for line in lines])
    return name2urls

def ensure_pretrained_models() -> None:
    models_path = get_models_path()
    for destination, url in parse_pretrained_models_file().items():
        destination = os.path.join(models_path, destination)
        if os.path.exists(destination):
            continue

        print(f'Downloading {url} ...')
        with urllib.request.urlopen(url) as f:
            os.makedirs( os.path.dirname(destination), exist_ok=True )
            open(destination, 'wb').write(f.read())


