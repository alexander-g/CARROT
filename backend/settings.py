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