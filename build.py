#!/bin/python
import os, shutil
import datetime


build_name = '%s_DigIT_WoodAnatomy'%(datetime.datetime.now().strftime('%Y%m%d_%Hh%Mm%Ss') )
build_dir  = 'builds/%s'%build_name

os.system('pyinstaller --noupx --hidden-import=tensorflow --hidden-import=tensorflow.lite.python.lite --hidden-import=astor --hidden-import=sklearn.utils._cython_blas --hidden-import=skimage.io._plugins.tifffile_plugin  --distpath %s -F main.py'%build_dir)


shutil.copytree('HTML',   build_dir+'/HTML')
shutil.copytree('models', build_dir+'/models')
shutil.rmtree('./build')
os.remove('./main.spec')

