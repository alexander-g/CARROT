import os
from base.backend import pubsub


def start_training(imagefiles, targetfiles, trainingtype, settings):
    #TODO: lock.acquire(blocking=False)
    model = settings.models[trainingtype]
    #indicate that the current model is unsaved
    settings.active_models[trainingtype] = ''
    ok = model.start_training(imagefiles, targetfiles, epochs=10, num_workers=0, callback=training_progress_callback)
    return 'OK' if ok else 'INTERRUPTED'

def training_progress_callback(x):
    pubsub.PubSub.publish({'progress':x,  'description':'Training...'}, event='training')

def find_targetfiles(inputfiles, trainingtype):
    def find_targetfile(imgf):
        no_ext_imgf = os.path.splitext(imgf)[0]
        for f in [f'{imgf}.{trainingtype}.png', f'{no_ext_imgf}.{trainingtype}.png']:
            if os.path.exists(f):
                return f
    return list(map(find_targetfile, inputfiles))
    
    if trainingtype == 'cells':
        targetfiles = [ f'{imgf}.cells.png' for imgf in inputfiles ]
    elif trainingtype == 'treerings':
        targetfiles = [ f'{imgf}.treerings.png' for imgf in inputfiles ]
    else:
        targetfiles = []
    targetfiles = [f for f in targetfiles if os.path.exists(f)]
    return targetfiles
