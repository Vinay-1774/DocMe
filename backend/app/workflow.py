from langgraph.graph import END, StateGraph

# Import shared state type and node functions from nodes.py
try:
    from app.nodes import GraphState, generate_node, retrieve_node
except ImportError:
    try:
        from backend.app.nodes import GraphState, generate_node, retrieve_node
    except ImportError:
        from nodes import GraphState, generate_node, retrieve_node


# 1. Initialize StateGraph with the shared state type
builder = StateGraph(GraphState)

# 2. Register retrieval and response-generation nodes
builder.add_node("retrieve", retrieve_node)
builder.add_node("generate", generate_node)

# 3. Define the linear workflow execution path
builder.set_entry_point("retrieve")
builder.add_edge("retrieve", "generate")
builder.add_edge("generate", END)

# 4. Compile the graph into a runnable workflow
workflow = builder.compile()
qa_workflow = workflow
