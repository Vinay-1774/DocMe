from langgraph.graph import END, StateGraph

from .nodes import GraphState, generate_node, retrieve_node

builder = StateGraph(GraphState)

builder.add_node("retrieve", retrieve_node)
builder.add_node("generate", generate_node)

builder.set_entry_point("retrieve")
builder.add_edge("retrieve", "generate")
builder.add_edge("generate", END)

workflow = builder.compile()
qa_workflow = workflow
