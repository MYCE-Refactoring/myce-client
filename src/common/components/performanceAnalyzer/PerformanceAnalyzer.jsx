import { useState, useEffect } from 'react';
import styles from './PerformanceAnalyzer.module.css';

const PerformanceAnalyzer = () => {
  const [uploadData, setUploadData] = useState([]);
  const [loadData, setLoadData] = useState([]);
  const [analysis, setAnalysis] = useState(null);

  useEffect(() => {
    // localStorage에서 성능 데이터 로드
    const upload = JSON.parse(localStorage.getItem('imageUploadPerformance') || '[]');
    const load = JSON.parse(localStorage.getItem('imageLoadPerformance') || '[]');
    
    setUploadData(upload);
    setLoadData(load);
    
    if (upload.length > 0 || load.length > 0) {
      analyzePerformance(upload, load);
    }
  }, []);

  const analyzePerformance = (upload, load) => {
    const s3Uploads = upload.filter(d => d.method === 's3');
    const localUploads = upload.filter(d => d.method === 'local');
    const s3Loads = load.filter(d => d.method === 's3');
    const localLoads = load.filter(d => d.method === 'local');

    const analysis = {
      upload: {
        s3: {
          count: s3Uploads.length,
          avgTime: s3Uploads.length > 0 ? s3Uploads.reduce((sum, d) => sum + d.totalTime, 0) / s3Uploads.length : 0,
          data: s3Uploads
        },
        local: {
          count: localUploads.length,
          avgTime: localUploads.length > 0 ? localUploads.reduce((sum, d) => sum + d.totalTime, 0) / localUploads.length : 0,
          data: localUploads
        }
      },
      load: {
        s3: {
          count: s3Loads.length,
          avgTime: s3Loads.length > 0 ? s3Loads.reduce((sum, d) => sum + d.loadTime, 0) / s3Loads.length : 0,
          data: s3Loads
        },
        local: {
          count: localLoads.length,
          avgTime: localLoads.length > 0 ? localLoads.reduce((sum, d) => sum + d.loadTime, 0) / localLoads.length : 0,
          data: localLoads
        }
      }
    };

    setAnalysis(analysis);
  };

  const clearData = () => {
    localStorage.removeItem('imageUploadPerformance');
    localStorage.removeItem('imageLoadPerformance');
    setUploadData([]);
    setLoadData([]);
    setAnalysis(null);
  };

  const exportData = () => {
    const data = {
      upload: uploadData,
      load: loadData,
      analysis: analysis,
      exportTime: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `image-performance-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!analysis) {
    return (
      <div className={styles.analyzer}>
        <h3>이미지 성능 분석기</h3>
        <p>성능 데이터가 없습니다. 이미지 업로드나 로딩을 테스트해보세요.</p>
      </div>
    );
  }

  return (
    <div className={styles.analyzer}>
      <div className={styles.header}>
        <h3>이미지 성능 분석 결과</h3>
        <div className={styles.actions}>
          <button onClick={exportData} className={styles.exportBtn}>
            데이터 내보내기
          </button>
          <button onClick={clearData} className={styles.clearBtn}>
            데이터 초기화
          </button>
        </div>
      </div>

      {/* 업로드 성능 */}
      <div className={styles.section}>
        <h4>📤 이미지 업로드 성능</h4>
        <div className={styles.comparison}>
          <div className={styles.method}>
            <h5>S3 업로드</h5>
            <div className={styles.stats}>
              <span>테스트 횟수: {analysis.upload.s3.count}회</span>
              <span>평균 시간: {analysis.upload.s3.avgTime.toFixed(2)}ms</span>
            </div>
          </div>
          <div className={styles.method}>
            <h5>로컬 업로드</h5>
            <div className={styles.stats}>
              <span>테스트 횟수: {analysis.upload.local.count}회</span>
              <span>평균 시간: {analysis.upload.local.avgTime.toFixed(2)}ms</span>
            </div>
          </div>
        </div>
        {analysis.upload.s3.count > 0 && analysis.upload.local.count > 0 && (
          <div className={styles.conclusion}>
            {analysis.upload.s3.avgTime < analysis.upload.local.avgTime ? (
              <span className={styles.winner}>
                ✅ S3 업로드가 {(analysis.upload.local.avgTime - analysis.upload.s3.avgTime).toFixed(2)}ms 더 빠름
              </span>
            ) : (
              <span className={styles.winner}>
                ✅ 로컬 업로드가 {(analysis.upload.s3.avgTime - analysis.upload.local.avgTime).toFixed(2)}ms 더 빠름
              </span>
            )}
          </div>
        )}
      </div>

      {/* 로딩 성능 */}
      <div className={styles.section}>
        <h4>📥 이미지 로딩 성능</h4>
        <div className={styles.comparison}>
          <div className={styles.method}>
            <h5>S3/CDN 로딩</h5>
            <div className={styles.stats}>
              <span>테스트 횟수: {analysis.load.s3.count}회</span>
              <span>평균 시간: {analysis.load.s3.avgTime.toFixed(2)}ms</span>
            </div>
          </div>
          <div className={styles.method}>
            <h5>로컬 서버 로딩</h5>
            <div className={styles.stats}>
              <span>테스트 횟수: {analysis.load.local.count}회</span>
              <span>평균 시간: {analysis.load.local.avgTime.toFixed(2)}ms</span>
            </div>
          </div>
        </div>
        {analysis.load.s3.count > 0 && analysis.load.local.count > 0 && (
          <div className={styles.conclusion}>
            {analysis.load.s3.avgTime < analysis.load.local.avgTime ? (
              <span className={styles.winner}>
                ✅ S3/CDN이 {(analysis.load.local.avgTime - analysis.load.s3.avgTime).toFixed(2)}ms 더 빠름
              </span>
            ) : (
              <span className={styles.winner}>
                ✅ 로컬 서버가 {(analysis.load.s3.avgTime - analysis.load.local.avgTime).toFixed(2)}ms 더 빠름
              </span>
            )}
          </div>
        )}
      </div>

      {/* 최근 데이터 */}
      <div className={styles.section}>
        <h4>📊 최근 테스트 결과</h4>
        <div className={styles.recentData}>
          <div>
            <h5>최근 업로드 (최대 5개)</h5>
            {uploadData.slice(-5).map((item, index) => (
              <div key={index} className={styles.dataItem}>
                <span className={styles.method}>{item.method.toUpperCase()}</span>
                <span>{item.totalTime.toFixed(2)}ms</span>
                <span>{(item.fileSize / 1024).toFixed(1)}KB</span>
                <span className={styles.time}>{new Date(item.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
          <div>
            <h5>최근 로딩 (최대 5개)</h5>
            {loadData.slice(-5).map((item, index) => (
              <div key={index} className={styles.dataItem}>
                <span className={styles.method}>{item.method.toUpperCase()}</span>
                <span>{item.loadTime.toFixed(2)}ms</span>
                <span className={styles.time}>{new Date(item.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PerformanceAnalyzer;