import os
import io

import numpy as np
import onnx
import torch



class MockTreeringsModel(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = torch.nn.Conv2d(3, 1, kernel_size=3, padding='same')
        # self.conv.weight.data[:] = self.conv.weight.data.abs()
        # self.conv.bias.data[:]   = self.conv.bias.data.abs()

    def forward(self, x:torch.Tensor) -> torch.Tensor:
        assert x.ndim == 4
        assert x.shape[-1] == 3
        assert x.dtype == torch.uint8

        x = x.permute(0,3,1,2).float() / 255
        x = self.conv(x)
        x = x[:,0]

        eye = torch.eye(x.shape[-2], x.shape[-1], device=x.device)
        x = (x * 0)
        x = x + eye
        x[:,:,-50:] += eye[:,:50]
        x[:,:,:50] += eye[:,-50:]

        return x.float()


def export(path:str, m:torch.nn.Module, x:torch.Tensor, meta:dict[str,str]):
    buffer = io.BytesIO()
    inputs = (x,)

    torch.onnx.export(
        model         = m,
        args          = inputs,
        f             = buffer,       # type: ignore[arg-type]
        export_params = True,
        training      = torch.onnx.TrainingMode.EVAL,
        input_names   = ['x'],
        output_names  = ['y'],
        verbose       = False,
        do_constant_folding = False,
        #opset_version = 12,
    )

    buffer.seek(0)
    onnxbytes = buffer.read()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'wb').write(onnxbytes)


    onnx_model = onnx.load(path)
    for key, value in meta.items():
        entry = onnx_model.metadata_props.add()
        entry.key = key
        entry.value = str(value)

    onnx.save(onnx_model, path)






if __name__ == '__main__':
    m = MockTreeringsModel().eval()
    x = torch.ones([1,640,640,3], dtype=torch.uint8)
    
    
    px_per_mm = 333
    meta = {
        "px-per-mm": f"{px_per_mm}",
        "modeltype": "carrot-treerings",
    }
    export('tests/testcases_deno/assets/onnx/treerings/mockmodel.onnx', m, x, meta)
    
    print('done')
