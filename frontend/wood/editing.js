


WoodEditing = class {
    static is_editing_active(filename){
        const $root  = $(`[filename="${filename}"]`)
        if($root.find('.edit-cells').hasClass('active'))
            return 'cells';
        if($root.find('.edit-treerings').hasClass('active'))
            return 'treerings';
        return false;
    }

    static activate_mode(filename, mode){
        const $root  = $(`[filename="${filename}"]`)
        if(this.is_editing_active(filename) != mode){
            this.clear(filename)
            $root.find(`.edit-menu-button, .edit-${mode}`).addClass('active')
        }
        $root.find('.edit-clear, .edit-apply').removeClass('disabled')
        $root.find('.test-canvas.overlay').css('pointer-events', 'all')
    }

    static on_edit_cells_button(event){
        const filename = $(event.target).closest('[filename]').attr('filename')
        this.activate_mode(filename, 'cells')
    }

    static on_edit_treerings_button(event){
        const filename = $(event.target).closest('[filename]').attr('filename')
        this.activate_mode(filename, 'treerings')
    }

    static async on_edit_apply(event){
        const $root    = $(event.target).closest('[filename]')
        const filename = $root.attr('filename')
        if(this.is_editing_active(filename) == 'treerings'){
            const prev_file = GLOBAL.files[filename].treering_results.segmentation;
            const imgbitmap = await createImageBitmap(prev_file)
            const canvas    = $root.find('.test-canvas.overlay')[0]
            const [W,H]     = [canvas.width, canvas.height]
            const newcanvas = $(`<canvas width="${W}" height="${H}">`)[0]
            const ctx       = newcanvas.getContext('2d')
            ctx.drawImage(imgbitmap, 0,0, W,H)
            ctx.drawImage(canvas, 0,0, W,H)
            newcanvas.toBlob(blob =>  {
                const f = new File([blob], prev_file.name);
                App.FileInput.load_result(filename, [f])
            }, 'image/png');
        } else {
            console.warn('TODO: apply cell corrections')
        }
        this.clear(filename)
    }

    static on_edit_clear(event){
        const filename = $(event.target).closest('[filename]').attr('filename')
        this.clear(filename)
    }

    static clear(filename){
        const $root  = $(`[filename="${filename}"]`)
        $root.find('.edit-menu-button, .edit-cells, .edit-treerings').removeClass('active')
        $root.find('.edit-clear, .edit-apply').addClass('disabled')

        const canvas = $root.find('.test-canvas.overlay')[0]
        canvas.getContext('2d').clearRect(0,0,canvas.width, canvas.height)
        $(canvas).css('pointer-events', 'none')
    }

    static on_mousedown(mousedown_event){
        const canvas   = mousedown_event.target;
        const filename = $(canvas).closest('[filename]').attr('filename')
        if(!this.is_editing_active(filename))
            return;
        if(mousedown_event.shiftKey)
            return;
        this.update_canvas_size(canvas)

        let start_xy = this.element2image_coordinates(canvas, [
             mousedown_event.pageX - $(canvas).offset().left,
             mousedown_event.pageY - $(canvas).offset().top,
        ])
        const ctx = canvas.getContext('2d')

        const _this = this;
        $(document).on('mousemove', function(mousemove_event) {
            if( (mousemove_event.buttons & 0x01)==0 ){
                //mouse button up
                $(document).off('mousemove');
                return;
            }

            const end_xy   = _this.element2image_coordinates(canvas, [
                mousemove_event.pageX - $(canvas).offset().left,
                mousemove_event.pageY - $(canvas).offset().top,
            ])

            ctx.strokeStyle = "green"
            ctx.lineWidth   = 16;          //TODO: hard-coded
            ctx.lineCap     = 'round';
            ctx.beginPath();
            ctx.moveTo(start_xy[0], start_xy[1]);
            ctx.lineTo(end_xy[0],   end_xy[1]  );
            ctx.stroke();

            start_xy = end_xy;
        });
    }

    static update_canvas_size(canvas){
        const $parent = $(canvas).closest('.set-aspect-ratio-manually')
        const W_cnv   = canvas.getAttribute('width')
        const H_cnv   = canvas.getAttribute('height')
        const W_img   = Number($parent.css('--imagewidth'))
        const H_img   = Number($parent.css('--imageheight'))
        if(W_cnv != W_img || H_cnv != H_img){
            canvas.setAttribute('width',  W_img)
            canvas.setAttribute('height', H_img)
        }
    }

    static element2image_coordinates(canvas, xy){
        const bbox    = canvas.getBoundingClientRect()
        const W_cnv   = bbox.width
        const H_cnv   = bbox.height
        const $parent = $(canvas).closest('.set-aspect-ratio-manually')
        const W_img   = Number($parent.css('--imagewidth'))
        const H_img   = Number($parent.css('--imageheight'))

        const xy_rel  = [ xy[0]/W_cnv,      xy[1]/H_cnv ]
        const xy_img  = [ xy_rel[0]*W_img,  xy_rel[1]*H_img ]
        return xy_img;
    }
}

