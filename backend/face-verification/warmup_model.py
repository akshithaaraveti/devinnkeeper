from deepface import DeepFace


if __name__ == "__main__":
    DeepFace.build_model("SFace")
    print("SFace model warmup completed")