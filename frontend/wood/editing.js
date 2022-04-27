


WoodEditing = class {
    static is_editing_active(filename){
        const $root  = $(`[filename="${filename}"]`)
        if($root.find('.edit-cells').hasClass('active'))
            return 'cells';
        if($root.find('.edit-treerings').hasClass('active'))
            return 'treerings';
        return false;
    }

    static async activate_mode(filename, mode, segmentation_file){
        const $root  = $(`[filename="${filename}"]`)
        if(this.is_editing_active(filename) != mode){
            this.clear(filename)
        }
        $root.find('.edit-menu .hidden-when-disabled').show()
        $root.find(`.edit-mode:not(.edit-${mode})`).addClass('disabled')
        $root.find(`.edit-menu-button, .edit-${mode}`).addClass('active').show()

        const canvas           = $root.find('.editing-canvas.overlay')[0]
        canvas.style.pointerEvents = 'all'

        //hide other overlays, paste segmentation onto canvas
        this.update_canvas_size(canvas)
        await paste_blob_onto_canvas(canvas, segmentation_file)
        const $other_overlays  = $(`[filename="${filename}"] .overlay:not(canvas)`)
        $other_overlays.css('visibility', 'hidden')
        set_brightness(filename, 0.5)
    }

    static on_edit_cells_button(event){
        const filename = $(event.target).closest('[filename]').attr('filename')
        this.activate_mode(filename, 'cells', GLOBAL.files[filename].cell_results.cells)
    }

    static on_edit_treerings_button(event){
        const filename = $(event.target).closest('[filename]').attr('filename')
        this.activate_mode(filename, 'treerings', GLOBAL.files[filename].treering_results.segmentation)
    }

    static async on_edit_apply(event){
        //TODO: what to do when not yet processed?
        //TODO: dimmer
        const $root    = $(event.target).closest('[filename]')
        const filename = $root.attr('filename')
        const mode     = this.is_editing_active(filename)
        let prev_file;
        if(mode == 'treerings'){
            prev_file = GLOBAL.files[filename].treering_results.segmentation;
        } else if(mode == 'cells'){
            prev_file = GLOBAL.files[filename].cell_results.cells;
        } else {
            console.warn('on_edit_apply() with unexpected editing mode:', mode)
            return;
        }
        
        try {
            App.Detection.set_processing(filename)
            const canvas    = $root.find('.editing-canvas.overlay')[0]
            canvas.toBlob(async blob =>  {
                const f = new File([blob], prev_file.name);
                await App.FileInput.load_result(filename, [f])
                this.clear(filename)
            }, 'image/png');
        } catch(e) {
            App.Detection.set_failed(filename)
        }
    }

    static on_edit_clear(event){
        //TODO: restore to what it was before
        const filename = $(event.target).closest('[filename]').attr('filename')
        this.clear(filename)
    }

    static clear(filename){
        const $root  = $(`[filename="${filename}"]`)
        $root.find('.edit-menu .hidden-when-disabled').hide()
        $root.find('.edit-menu-button, .edit-mode').removeClass('active disabled')

        const canvas = $root.find('.editing-canvas.overlay')[0]
        canvas.getContext('2d').clearRect(0,0,canvas.width, canvas.height)
        $(canvas).css('pointer-events', 'none')

        //show the other overlays again
        const $other_overlays  = $(`[filename="${filename}"] .overlay:not(canvas)`)
        $other_overlays.css('visibility', '')
    }

    static on_mousedown(mousedown_event){
        const canvas   = mousedown_event.target;
        const $root    = $(canvas).closest('[filename]')
        const filename = $root.attr('filename')
        if(!this.is_editing_active(filename))
            return;
        if(mousedown_event.shiftKey)
            return;
        this.update_canvas_size(canvas)

        let start_xy = this.element2image_coordinates(canvas, [
             mousedown_event.pageX - $(canvas).offset().left,
             mousedown_event.pageY - $(canvas).offset().top,
        ])
        const ctx       = canvas.getContext('2d')
        const clear     = mousedown_event.ctrlKey
        ctx.strokeStyle = clear? "black" : "white";
        ctx.lineWidth   = $root.find('.brush-size-slider').slider('get value')
        //double size for easier removing
        ctx.lineWidth   = clear? ctx.lineWidth*2 : ctx.lineWidth;
        ctx.lineCap     = 'round';

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


async function paste_blob_onto_canvas(canvas, blob){
    const imgbitmap = await createImageBitmap(blob)
    const ctx       = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(imgbitmap, 0,0, canvas.width,canvas.height)
}

