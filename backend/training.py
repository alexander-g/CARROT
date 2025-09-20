import os
import typing as tp

import PIL.Image

from base.backend import GLOBALS, pubsub
from base.backend.processing import resize_image

from carrot_ml.src import treeringmodel as treerings
from carrot_ml.src import maskrcnn_celldetection as cells


def start_training(
    imagefiles:   tp.List[str], 
    targetfiles:  tp.List[str], 
    trainingtype: tp.Literal['cells', 'treerings'], 
    cachedir:     str,
    settings,
):
    locked = GLOBALS.processing_lock.acquire(blocking=False)
    if not locked:
        raise RuntimeError('Cannot start training. Already processing.')
    
    assert len(imagefiles) == len(targetfiles)
    targetfiles = resize_targets_to_inputs(targetfiles, imagefiles)
    filepairs = list(zip(imagefiles, targetfiles))

    with GLOBALS.processing_lock:
        GLOBALS.processing_lock.release()  #decrement recursion level bc acquired twice
    
        
        # ok = model.start_training(imagefiles, targetfiles, epochs='auto', num_workers=0, callback=training_progress_callback)
        # return 'OK' if ok in [True, None] else 'INTERRUPTED'

        px_per_mm = settings.micrometer_factor * 1000
        outputfile = os.path.join(cachedir, f'unsaved-model-{trainingtype}.pt.zip')

        if trainingtype == 'treerings':
            steps = 500
            newmodel = treerings.start_training_from_carrot(
                filepairs,
                cachedir,
                px_per_mm,
                epochs = None,
                steps  = steps,
                progress_callback = training_progress_callback,
                finetunemodule=settings.models[trainingtype].module.module,
            )
        elif trainingtype == 'cells':
            steps = 100
            newmodel = cells.start_training_from_carrot(
                filepairs,
                cachedir,
                px_per_mm,
                epochs = None,
                steps  = steps,
                progress_callback = training_progress_callback,
                #finetunemodule=settings.models[trainingtype].module.module,
            )
        else:
            raise NotImplementedError(trainingtype)
        
        # NOTE: not saving newmodel because of errors
        # instead saving previous with new state dict
        # newmodel.save(outputfile)
        sd = newmodel.state_dict()
        newmodel = settings.models[trainingtype]
        print(newmodel.load_state_dict(sd))

        #indicate that the current model is unsaved
        settings.active_models[trainingtype] = ''
        settings.models[trainingtype] = newmodel
    return 'OK'


def training_progress_callback(x:float):
    pubsub.PubSub.publish(
        {'progress':x,  'description':'Training...'}, 
        event = 'training'
    )

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

def resize_targets_to_inputs(
    targetfiles: tp.List[str], 
    inputfiles:  tp.List[str],
) -> tp.List[str]:
    assert len(targetfiles) == len(inputfiles)
    new_targetfiles = []
    for tgfile, infile in zip(targetfiles, inputfiles):
        insize = PIL.Image.open(infile).size
        tgsize = PIL.Image.open(tgfile).size
        if tgsize != insize:
            new_tgfile, _ = resize_image(tgfile, insize, jpeg_ok=False)
        else:
            new_tgfile = tgfile
        new_targetfiles.append(new_tgfile)
    return new_targetfiles

