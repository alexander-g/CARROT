binaries = []    


from PyInstaller.compat import is_win
if is_win:
    binaries += [('hooks/VC_redist/*', '.')]
    print("Adding binaries for torch: ", binaries)