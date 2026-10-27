import os
import sys
import zipfile

origem, destino, camada = sys.argv[1:4]
vistos = set()
with zipfile.ZipFile(origem, "r") as entrada, zipfile.ZipFile(destino, "w") as saida:
    for info in entrada.infolist():
        caminho = os.path.join(camada, info.filename)
        dados = open(caminho, "rb").read() if os.path.isfile(caminho) else entrada.read(info.filename)
        if os.path.isfile(caminho):
            vistos.add(info.filename)
        saida.writestr(info, dados)
    for raiz, _dirs, arquivos in os.walk(camada):
        for nome in arquivos:
            cheio = os.path.join(raiz, nome)
            relativo = os.path.relpath(cheio, camada).replace(os.sep, "/")
            if relativo not in vistos:
                saida.write(cheio, relativo)
