import os
import sys

root_path = os.path.dirname( os.path.realpath(sys.executable) )
path_text = str(root_path).lower()

if ".zip" in path_text or r"\temp\7z" in path_text:
    print("Error: Please unzip the archive before running this file.")
    input("Press Enter to exit...")
    sys.exit(1)

# else run normally



import subprocess
import traceback

try:
	exepath = os.path.join(root_path, 'main', 'main.exe')
	result  = subprocess.run(
        [exepath, *sys.argv[1:]],
        stdin  = None,
        stdout = None,
        stderr = None,
        env    = {**os.environ, 'PYTHONUNBUFFERED':'1', 'ROOT_PATH':root_path}
    )
	sys.exit(result.returncode)
except SystemExit:
	pass
except:
	traceback.print_exc()
	input("Press Enter to exit...")




