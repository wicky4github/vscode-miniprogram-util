const fs = require('fs')
const path = require('path')

const dirname = dir => dir.substr(dir.lastIndexOf('/') + 1)

const mkdirs = dir => {
    if (fs.existsSync(dir)) {
        return true
    } else {
        if (mkdirs(path.dirname(dir))) {
            fs.mkdirSync(dir)
            return true
        }
    }
}

const copy = (src, dest, filter) => {
    if (!fs.existsSync(dest)) {
        mkdirs(src)
    }
    if (!fs.existsSync(src)) {
        return false
    }
    const stats = fs.statSync(src)
    if (stats.isFile()) {
        if (typeof filter === 'function' && filter(dest, src) === false) {
            console.log(`Skip File: ${src} => ${dest}`)
            return
        }
        console.log(`Move File: ${src} => ${dest}`)
        try {
            fs.copyFileSync(src, dest)
        } catch (e) {
            console.log(e)
        }
    } else if (stats.isDirectory()) {
        const dirs = fs.readdirSync(src)
        dirs.forEach((item) => {
            const isrc = path.join(src, item)
            const stats = fs.statSync(isrc)
            const idest = path.join(dest, item)
            if (stats.isFile()) {
                if (typeof filter === 'function' && filter(idest, isrc) === false) {
                    console.log(`Skip Dir: ${isrc} => ${idest}`)
                    return
                }
                console.log(`Move Dir: ${isrc} => ${idest}`)
                fs.copyFileSync(isrc, idest)
            } else if (stats.isDirectory()) {
                copy(isrc, idest)
            }
        })
    }
}


const humansize = (bytes) => {
    if (bytes === 0) return '0 MB'
    let k = 1024, // or 1000
        sizes = ['MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'],
        i = Math.floor(Math.log(bytes) / Math.log(k))
    return (bytes / Math.pow(k, i)).toFixed(0) + ' ' + sizes[i]
}

const timeStr = () => {
    return '[' + new Date().toLocaleString() + ']'
}

module.exports = {
    dirname,
    mkdirs,
    copy,
    humansize,
    timeStr,
}