from fastapi import FastAPI

app = FastAPI(title="solver-python")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/optimize")
def optimize():
    # Stub: a formulação MILP real (registro-decisoes-tecnicas.md, decisões 3/6/9)
    # entra numa tarefa futura do roadmap.
    return {"detail": "not implemented yet"}
