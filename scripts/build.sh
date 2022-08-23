#!/bin/zsh

rm -rf dist 
mkdir dist

npx minify-html --output dist/index.html --minify-css --do_not_minify_doctype --ensure_spec_compliant_unquoted_attribute_values true src/index.html 

esbuild=$(npx esbuild --bundle src/index.js --bundle src/worker.js --target=safari13,chrome100 --entry-names="[name]-[hash]" --outdir=dist --minify --sourcemap 2>&1 )
if [[ $? -ne 0 ]]; then
  echo $esbuild
  exit 1
fi

set -e

IFS=\; read indexHASH workerHASH < <( echo $esbuild | tr '\n' '\r' | sed -r "s/^.*index-([^.]+)\.js.+worker-([^.]+)\.js.*$/\1;\2\n/" )
indexhash=$(echo $indexHASH | tr '[:upper:]' '[:lower:]')
workerhash=$(echo $workerHASH | tr '[:upper:]' '[:lower:]')

mv dist/index-{$indexHASH,$indexhash}.js
mv dist/worker-{$workerHASH,$workerhash}.js
mv dist/index-{$indexHASH,$indexhash}.js.map
mv dist/worker-{$workerHASH,$workerhash}.js.map

sed -ri .bak -e "s/\.\/worker\.js/.\/worker-${workerhash}.js/g" -e "s/\.\/index\.js/.\/index-${indexhash}.js/g" dist/index.html 
sed -ri .bak -e "s/\.\/worker\.js */.\/worker-${workerhash}.js/g" -e "s/index-${indexHASH}\.js\.map/index-${indexhash}.js.map/g" dist/index-${indexhash}.js
sed -ri .bak "s/worker-${workerHASH}\.js\.map/worker-${workerhash}.js.map/g" dist/worker-${workerhash}.js

rm -f dist/*.bak