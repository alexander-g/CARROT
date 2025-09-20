import os
import typing as tp
import zipfile

import PIL.Image

from base.backend import GLOBALS, pubsub
from base.backend.processing import resize_image
from base.backend.app import get_models_path

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
        _save_new_model_TEMPORARY_WORKAROUND(newmodel, settings, trainingtype, outputfile)

        #indicate that the current model is unsaved
        settings.active_models[trainingtype] = ''
        settings.models[trainingtype] = newmodel
    return 'OK'


def _save_new_model_TEMPORARY_WORKAROUND(
    newmodel, 
    settings, 
    trainingtype: str, 
    outputpath:   str,
) -> None:
    sd = newmodel.state_dict()
    newmodel = settings.models[trainingtype]
    print(newmodel.load_state_dict(sd))
    tmp_outputpath = outputpath + '.tmp.pt.zip'
    newmodel.save(tmp_outputpath)

    current_modelname = settings.active_models[trainingtype]
    path_to_current_model = get_path_to_model(trainingtype, current_modelname)
    if path_to_current_model is None:
        print('[WARNING] could not find current model file')
        return
    
    merge_zipfiles(outputpath, tmp_outputpath, path_to_current_model)
    

def merge_zipfiles(
    dstfile:str, 
    srcfile0:str, 
    srcfile1:str,
    do_overwrite: tp.List[str] = ['.data/extern_modules'],
):
    '''Copy files from zipfiles srcfile0 and srcfile1 into dstfile.
       Files from srcfile1 will be ignored if already present.
       Also path manipulation. Also do overwrite some files even if present.'''
    dstbase = os.path.basename(dstfile).replace('.pt.zip', '.pt')
    do_overwrite = ['/'.join([dstbase, overwrite]) for overwrite in do_overwrite]
    print(do_overwrite)

    already_written = []
    with zipfile.ZipFile(dstfile, 'w') as zipf_dst:
        with zipfile.ZipFile(srcfile0) as zipf_src0:
            for name in zipf_src0.namelist():
                name_dst = '/'.join([dstbase] + name.split('/')[1:])
                if not name_dst in do_overwrite:
                    zipf_dst.writestr(name_dst, zipf_src0.read(name))
                    already_written.append(name_dst)
        
        with zipfile.ZipFile(srcfile1) as zipf_src1:
            for name in zipf_src1.namelist():
                name_dst = '/'.join([dstbase] + name.split('/')[1:])
                if name_dst in already_written:
                    continue
                zipf_dst.writestr(name_dst, zipf_src1.read(name))
                already_written.append(name_dst)




def get_path_to_model(modeltype:str, modelname:str) -> tp.Optional[str]:
    for ending in ['.pt', '.pt.zip']:
        models_dir = get_models_path()
        abspath = os.path.join(models_dir, modeltype, f'{modelname}{ending}')
        if os.path.exists(abspath):
            return abspath
    return None


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

