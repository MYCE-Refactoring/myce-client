import { useState, useEffect } from 'react';
import styles from './ImageUpload.module.css';
import instance from '../../../api/lib/axios';

const ImageUploadComparison = ({ onUploadSuccess, onUploadError, accept = "image/*", maxSize = 10 * 1024 * 1024 }) => {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadMethod, setUploadMethod] = useState('s3'); // 's3' or 'mongodb'
  const [performanceResults, setPerformanceResults] = useState([]);

  const handleFileSelect = (file) => {
    if (!file) return;

    // 파일 크기 검증
    if (file.size > maxSize) {
      onUploadError && onUploadError("파일 크기는 10MB를 초과할 수 없습니다.");
      return;
    }

    // 파일 타입 검증
    if (!file.type.startsWith("image/")) {
      onUploadError && onUploadError("이미지 파일만 업로드 가능합니다.");
      return;
    }

    // 미리보기 생성
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(file);

    // 업로드 시작
    uploadImage(file);
  };

  const uploadImage = async (file) => {
    setUploading(true);
    const startTime = performance.now();

    try {
      let result;
      
      if (uploadMethod === 's3') {
        result = await uploadToS3(file, startTime);
      } else {
        result = await uploadToMongo(file, startTime);
      }

      // 성능 결과 저장
      const performanceData = {
        method: uploadMethod,
        fileSize: file.size,
        uploadTime: result.uploadTime,
        totalTime: performance.now() - startTime,
        timestamp: new Date().toISOString(),
        fileName: file.name
      };

      setPerformanceResults(prev => [...prev, performanceData]);
      
      // localStorage에 성능 데이터 저장
      const existingData = JSON.parse(localStorage.getItem('imageUploadPerformance') || '[]');
      localStorage.setItem('imageUploadPerformance', JSON.stringify([...existingData, performanceData]));

      console.log(`✅ [${uploadMethod.toUpperCase()}] 이미지 업로드 완료:`, performanceData);

      onUploadSuccess && onUploadSuccess(result.url);
    } catch (error) {
      console.error("업로드 실패:", error);
      onUploadError && onUploadError("이미지 업로드에 실패했습니다.");
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const uploadToS3 = async (file, startTime) => {
    // 1. Presigned URL 요청
    const presignTime = performance.now();
    const response = await instance.get('/images/presign', {
      params: { filename: file.name }
    });
    const presignDuration = performance.now() - presignTime;

    const { uploadUrl, cdnUrl } = response.data;

    // 2. S3에 직접 업로드
    const uploadTime = performance.now();
    await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": file.type,
      },
    });
    const uploadDuration = performance.now() - uploadTime;

    console.log(`📊 S3 업로드 세부 시간:`, {
      presignTime: `${presignDuration.toFixed(2)}ms`,
      uploadTime: `${uploadDuration.toFixed(2)}ms`,
      totalTime: `${(performance.now() - startTime).toFixed(2)}ms`
    });

    return {
      url: cdnUrl,
      uploadTime: performance.now() - startTime
    };
  };

  const uploadToMongo = async (file, startTime) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await instance.post('/images/mongo-upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    const totalTime = performance.now() - startTime;
    console.log(`📊 MongoDB 업로드 세부 시간:`, {
      serverTime: `${response.data.uploadTime}ms`,
      totalTime: `${totalTime.toFixed(2)}ms`
    });

    return {
      url: response.data.url,
      uploadTime: totalTime
    };
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files[0];
    handleFileSelect(file);
  };

  const removeImage = () => {
    setPreview(null);
    onUploadSuccess && onUploadSuccess(null);
  };

  const showPerformanceResults = () => {
    const allData = JSON.parse(localStorage.getItem('imageUploadPerformance') || '[]');
    console.table(allData);
    
    if (allData.length > 0) {
      const s3Results = allData.filter(d => d.method === 's3');
      const mongoResults = allData.filter(d => d.method === 'mongodb');
      
      if (s3Results.length > 0 && mongoResults.length > 0) {
        const s3Avg = s3Results.reduce((sum, r) => sum + r.totalTime, 0) / s3Results.length;
        const mongoAvg = mongoResults.reduce((sum, r) => sum + r.totalTime, 0) / mongoResults.length;
        
        console.log(`📊 성능 비교 결과:
S3+CloudFront 평균: ${s3Avg.toFixed(2)}ms (${s3Results.length}회)
MongoDB 평균: ${mongoAvg.toFixed(2)}ms (${mongoResults.length}회)
차이: ${Math.abs(s3Avg - mongoAvg).toFixed(2)}ms (${s3Avg > mongoAvg ? 'MongoDB가 빠름' : 'S3+CloudFront가 빠름'})`);
      }
    }
  };

  return (
    <div className={styles.imageUpload}>
      {/* 업로드 방식 선택 */}
      <div style={{ marginBottom: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
        <label>
          <input
            type="radio"
            value="s3"
            checked={uploadMethod === 's3'}
            onChange={(e) => setUploadMethod(e.target.value)}
            disabled={uploading}
          />
          S3 업로드
        </label>
        <label>
          <input
            type="radio"
            value="mongodb"
            checked={uploadMethod === 'mongodb'}
            onChange={(e) => setUploadMethod(e.target.value)}
            disabled={uploading}
          />
          MongoDB 업로드
        </label>
        <button 
          type="button" 
          onClick={showPerformanceResults}
          style={{ marginLeft: '20px', fontSize: '12px', padding: '5px 10px' }}
        >
          성능 결과 보기
        </button>
      </div>

      <div
        className={`${styles.uploadArea} ${dragOver ? styles.dragOver : ""} ${
          uploading ? styles.uploading : ""
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() =>
          !uploading && document.getElementById("fileInput").click()
        }
      >
        <input
          id="fileInput"
          type="file"
          accept={accept}
          onChange={handleFileInputChange}
          style={{ display: "none" }}
          disabled={uploading}
        />

        {preview ? (
          <div className={styles.previewContainer}>
            <img src={preview} alt="미리보기" className={styles.preview} />
            <button
              type="button"
              className={styles.removeButton}
              onClick={(e) => {
                e.stopPropagation();
                removeImage();
              }}
              disabled={uploading}
            >
              ×
            </button>
          </div>
        ) : (
          <div className={styles.uploadPlaceholder}>
            {uploading ? (
              <div className={styles.loading}>
                <div className={styles.spinner}></div>
                <p>{uploadMethod === 's3' ? 'S3' : 'MongoDB'}에 업로드 중...</p>
              </div>
            ) : (
              <>
                <div className={styles.uploadIcon}>📷</div>
                <p>이미지를 드래그하거나<br></br> 클릭하여 업로드</p>
                <small>최대 10MB, JPG, PNG, GIF 지원</small>
                <small style={{ color: uploadMethod === 's3' ? '#0066cc' : '#cc6600' }}>
                  현재: {uploadMethod === 's3' ? 'S3+CloudFront' : 'MongoDB'} 업로드
                </small>
              </>
            )}
          </div>
        )}
      </div>

      {/* 최근 성능 결과 표시 */}
      {performanceResults.length > 0 && (
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
          <strong>최근 업로드 결과:</strong>
          {performanceResults.slice(-3).map((result, index) => (
            <div key={index}>
              {result.method.toUpperCase()}: {result.totalTime.toFixed(2)}ms 
              ({(result.fileSize / 1024).toFixed(1)}KB)
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ImageUploadComparison;